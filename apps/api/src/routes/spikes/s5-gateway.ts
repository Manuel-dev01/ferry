import {
  corridorCurrencySchema,
  evmAddressSchema,
  hexSchema,
  normalizeAccountIdentifier,
  parseUnits,
  POLYGON_CHAIN_ID,
  usdtToFiatMinor,
  USDT_DECIMALS,
} from '@ferry/shared'
import { Hono } from 'hono'
import { erc20Abi, getAddress, zeroAddress, type Address } from 'viem'
import { z } from 'zod'
import type { AppEnv, Deps } from '../../app'
import { HttpError } from '../../errors'
import {
  buildGatewayCalls,
  buildRecipient,
  encryptRecipient,
  gatewayAbi,
  gatewayGasNeedWei,
  orderIdFromLogs,
  POLYGON_GATEWAY,
  scaleRate,
} from '../../gateway'
import { polygonFees } from '../../polygon'
import { parseJson, parseValue } from '../validate'

const prepareSchema = z.object({
  currency: corridorCurrencySchema,
  institution: z.string().min(1).max(32),
  accountIdentifier: z.string().min(5).max(32),
  amount: z.string().regex(/^\d+(\.\d{1,6})?$/),
  from: evmAddressSchema,
})

/**
 * Spike S5: a real off-ramp order created by the user's own wallet directly on Paycrest's
 * Gateway contract (approve + createOrder), without a sender API key. Money moves from the
 * user's wallet to the Gateway; refunds go back to the same wallet. Capped small.
 */
export function s5Routes(deps: Deps) {
  const r = new Hono<AppEnv>()
  const { env, polygon, paycrest } = deps
  const token = env.USDT0_ADDRESS as Address

  r.post('/gateway/prepare', async (c) => {
    const log = c.get('log').child({ spike: 's5' })
    const body = await parseJson(c, prepareSchema)
    const from = getAddress(body.from)
    const amount = parseUnits(body.amount, USDT_DECIMALS)
    if (amount < env.spikeGatewayMinUnits || amount > env.spikeGatewayMaxUnits) {
      throw new HttpError(
        400,
        'SPIKE_LIMIT',
        `Test orders are ${env.SPIKE_GATEWAY_MIN_USDT}–${env.SPIKE_GATEWAY_MAX_USDT} USDT`,
      )
    }
    const institution = (await paycrest.public.institutions(body.currency)).find(
      (i) => i.code === body.institution,
    )
    if (!institution)
      throw new HttpError(400, 'UNKNOWN_INSTITUTION', "We don't support that bank yet")
    const identifier = normalizeAccountIdentifier(
      body.currency,
      institution.type,
      body.accountIdentifier,
    )
    if (!identifier) throw new HttpError(400, 'INVALID_ACCOUNT', 'That account number looks wrong')

    const [accountName, rate, pem, balance, allowance, supported] = await Promise.all([
      paycrest.public.verifyAccount(institution.code, identifier),
      paycrest.public.sellRate(body.currency, (amount + 999_999n) / 1_000_000n || 1n),
      paycrest.public.publicKey(),
      polygon.readContract({
        address: token,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [from],
      }),
      polygon.readContract({
        address: token,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [from, POLYGON_GATEWAY],
      }),
      polygon.readContract({
        address: POLYGON_GATEWAY,
        abi: gatewayAbi,
        functionName: 'isTokenSupported',
        args: [token],
      }),
    ])
    if (!rate)
      throw new HttpError(503, 'CORRIDOR_PAUSED', 'Payouts to this country are paused right now')
    if (!supported)
      throw new HttpError(
        503,
        'GATEWAY_TOKEN_UNSUPPORTED',
        'The Gateway does not accept this token',
      )
    if (balance < amount)
      throw new HttpError(400, 'INSUFFICIENT_USDT', 'Not enough USDT for this test')

    const messageHash = encryptRecipient(
      buildRecipient({
        institution: institution.code,
        accountIdentifier: identifier,
        accountName,
        memo: 'Ferry',
      }),
      pem,
    )
    const calls = buildGatewayCalls({
      gateway: POLYGON_GATEWAY,
      token,
      amount,
      rate: scaleRate(rate),
      senderFeeRecipient: zeroAddress,
      senderFee: 0n,
      refundAddress: from,
      messageHash,
    })
    const needsApprove = allowance < amount
    const fees = await polygonFees(polygon)
    log.info(
      { currency: body.currency, institution: institution.code, amount: amount.toString(), rate },
      'gateway order prepared',
    )
    return c.json({
      accountName,
      institutionName: institution.name,
      rate,
      amountUnits: amount.toString(),
      theyReceiveMinor: usdtToFiatMinor(amount, rate).toString(),
      gateway: POLYGON_GATEWAY,
      chainId: POLYGON_CHAIN_ID,
      needsApprove,
      gasNeededWei: gatewayGasNeedWei(fees.maxFeePerGas, needsApprove).toString(),
      approve: calls.approve,
      createOrder: calls.createOrder,
    })
  })

  // Follow an order from the createOrder transaction: on-chain state plus Paycrest's view.
  r.get('/gateway/order/:tx', async (c) => {
    const tx = parseValue(hexSchema, c.req.param('tx'))
    if (tx.length !== 66) throw new HttpError(400, 'INVALID_REQUEST', 'Not a transaction hash')
    const receipt = await polygon.getTransactionReceipt({ hash: tx }).catch(() => null)
    if (!receipt) return c.json({ stage: 'pending', txHash: tx })
    if (receipt.status !== 'success') return c.json({ stage: 'reverted', txHash: tx })
    const orderId = orderIdFromLogs(receipt.logs, POLYGON_GATEWAY)
    if (!orderId) return c.json({ stage: 'no_order', txHash: tx })
    const [info, aggregator] = await Promise.all([
      polygon.readContract({
        address: POLYGON_GATEWAY,
        abi: gatewayAbi,
        functionName: 'getOrderInfo',
        args: [orderId],
      }),
      paycrest.public.gatewayOrder(POLYGON_CHAIN_ID, orderId).catch(() => null),
    ])
    const stage = info.isFulfilled ? 'settled' : info.isRefunded ? 'refunded' : 'created'
    c.get('log').info(
      { spike: 's5', orderId, stage, aggregatorStatus: aggregator?.status ?? null },
      'gateway order status',
    )
    return c.json({
      stage,
      txHash: tx,
      orderId,
      aggregator: aggregator
        ? {
            status: aggregator.status ?? null,
            txHash: aggregator.txHash ?? null,
            amount: aggregator.amount ?? null,
          }
        : null,
    })
  })

  return r
}
