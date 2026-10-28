import {
  hexSchema,
  spikeGasDripRequestSchema,
  spikeRelayRequestSchema,
  evmAddressSchema,
  type SpikeConfigResponse,
  type SpikeGasDripResponse,
  type SpikeTxResponse,
  type TxStatus,
} from '@ferry/shared'
import { Hono } from 'hono'
import {
  BaseError,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  keccak256,
  WaitForTransactionReceiptTimeoutError,
  type Address,
  type Hex,
} from 'viem'
import type { AppEnv, Deps } from '../../app'
import { HttpError } from '../../errors'
import { gatewayGasNeedWei } from '../../gateway'
import { verifyMetaTx } from '../../metatx'
import { metaTxAbi, polygonFees } from '../../polygon'
import { parseJson, parseValue } from '../validate'

const RECEIPT_TIMEOUT_MS = 90_000

const short = (err: unknown) => (err instanceof BaseError ? err.shortMessage : String(err))

export function s2Routes(deps: Deps) {
  const r = new Hono<AppEnv>()
  const { env, polygon, relayer } = deps
  const token = env.USDT0_ADDRESS as Address
  const recipient = env.SPIKE_ALLOWED_RECIPIENT ? getAddress(env.SPIKE_ALLOWED_RECIPIENT) : null
  const requireRecipient = () => {
    if (!recipient) {
      throw new HttpError(
        503,
        'SPIKE_NOT_CONFIGURED',
        'SPIKE_ALLOWED_RECIPIENT is not set on the server',
      )
    }
    return recipient
  }

  // Spike-only abuse guards; this process may be reachable by anyone on the network.
  let relaysUsed = 0
  let relayInFlight = false
  const dripped = new Map<string, number>() // address → drips this server run
  const MAX_DRIPS_PER_ADDRESS = 3

  const requireRelayer = () => {
    if (!relayer) {
      throw new HttpError(503, 'RELAYER_NOT_CONFIGURED', 'The relayer key is not set on the server')
    }
    return relayer
  }

  /** Broadcast a signed transaction whose hash we already know, then wait for the receipt. */
  async function broadcastAndWait(serialized: Hex, log: AppEnv['Variables']['log']) {
    const txHash = keccak256(serialized)
    try {
      await polygon.sendRawTransaction({ serializedTransaction: serialized })
    } catch (err) {
      // The node may have accepted it before the error; report unknown, never resend.
      log.warn({ txHash, err: short(err) }, 'broadcast error; outcome unknown')
      return { txHash, status: 'unknown' as TxStatus }
    }
    try {
      const receipt = await polygon.waitForTransactionReceipt({
        hash: txHash,
        timeout: RECEIPT_TIMEOUT_MS,
      })
      return { txHash, status: receipt.status as TxStatus }
    } catch (err) {
      if (err instanceof WaitForTransactionReceiptTimeoutError)
        return { txHash, status: 'pending' as TxStatus }
      throw err
    }
  }

  r.get('/config', async (c) => {
    const relayerInfo = relayer
      ? {
          address: relayer.account.address,
          pol: (await polygon.getBalance({ address: relayer.account.address })).toString(),
        }
      : null
    const body: SpikeConfigResponse = {
      recipient,
      maxUsdt: env.spikeMaxUsdtUnits.toString(),
      relayer: relayerInfo,
      gasDrip: { enabled: env.GAS_DRIP_ENABLED, amountWei: env.gasDripWei.toString() },
      lnMaxSats: env.SPIKE_LN_MAX_SATS,
    }
    return c.json(body)
  })

  r.get('/metatx/nonce/:address', async (c) => {
    const address = getAddress(parseValue(evmAddressSchema, c.req.param('address')))
    const nonce = await polygon.readContract({
      address: token,
      abi: metaTxAbi,
      functionName: 'getNonce',
      args: [address],
    })
    return c.json({ nonce: nonce.toString() })
  })

  // Path A: verify the user's signed meta-transaction and submit it from the relayer.
  r.post('/relay', async (c) => {
    const log = c.get('log').child({ spike: 's2a' })
    const body = await parseJson(c, spikeRelayRequestSchema)
    const wallet = requireRelayer()
    if (relaysUsed >= env.SPIKE_MAX_RELAYS) {
      throw new HttpError(
        429,
        'SPIKE_LIMIT',
        'The spike relay limit for this server run is used up',
      )
    }
    if (relayInFlight) throw new HttpError(409, 'RELAY_BUSY', 'Another relay is in progress')
    relayInFlight = true
    try {
      const from = getAddress(body.from)
      const onchainNonce = await polygon.readContract({
        address: token,
        abi: metaTxAbi,
        functionName: 'getNonce',
        args: [from],
      })
      const tx = await verifyMetaTx(
        {
          from,
          nonce: BigInt(body.nonce),
          functionSignature: body.functionSignature,
          signature: body.signature,
        },
        {
          recipient: requireRecipient(),
          amount: env.spikeMaxUsdtUnits,
          exact: false,
          onchainNonce,
        },
      )
      const balance = await polygon.readContract({
        address: token,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [from],
      })
      if (balance < tx.amount) {
        throw new HttpError(400, 'INSUFFICIENT_USDT', 'Not enough USDT for this transfer')
      }

      const args = [tx.from, tx.functionSignature, tx.r, tx.s, tx.v] as const
      let gas: bigint
      try {
        await polygon.simulateContract({
          account: wallet.account,
          address: token,
          abi: metaTxAbi,
          functionName: 'executeMetaTransaction',
          args,
        })
        gas = await polygon.estimateContractGas({
          account: wallet.account,
          address: token,
          abi: metaTxAbi,
          functionName: 'executeMetaTransaction',
          args,
        })
      } catch (err) {
        log.warn({ err: short(err) }, 'meta-tx simulation failed')
        throw new HttpError(400, 'METATX_SIMULATION_FAILED', 'The transfer would fail on-chain', {
          reason: short(err),
        })
      }

      const fees = await polygonFees(polygon)
      const request = await wallet.prepareTransactionRequest({
        to: token,
        data: encodeFunctionData({ abi: metaTxAbi, functionName: 'executeMetaTransaction', args }),
        gas: (gas * 12n) / 10n,
        ...fees,
      })
      const serialized = await wallet.signTransaction(request)
      relaysUsed += 1
      log.info({ from, amount: tx.amount.toString(), nonce: body.nonce }, 'relaying meta-tx')
      const result = await broadcastAndWait(serialized, log)
      log.info(result, 'meta-tx relay result')
      const res: SpikeTxResponse = result
      return c.json(res, result.status === 'success' ? 200 : 202)
    } finally {
      relayInFlight = false
    }
  })

  // Path B, step 1: send a little POL so the user can pay gas for a normal transfer.
  r.post('/gas-drip', async (c) => {
    const log = c.get('log').child({ spike: 's2b' })
    if (!env.GAS_DRIP_ENABLED) throw new HttpError(404, 'GAS_DRIP_DISABLED', 'Gas drip is off')
    const wallet = requireRelayer()
    const address = getAddress((await parseJson(c, spikeGasDripRequestSchema)).address)

    // Top up to what a Gateway order needs at today's fees, so the wallet's own check passes.
    const fees = await polygonFees(polygon)
    const need = gatewayGasNeedWei(fees.maxFeePerGas, true)
    const target =
      need < env.gasDripWei ? env.gasDripWei : need > env.gasDripCapWei ? env.gasDripCapWei : need
    const current = await polygon.getBalance({ address })
    if (current >= target) {
      const res: SpikeGasDripResponse = { status: 'already_funded', txHash: null, txStatus: null }
      return c.json(res)
    }
    const times = dripped.get(address) ?? 0
    if (times >= MAX_DRIPS_PER_ADDRESS) {
      throw new HttpError(429, 'GAS_DRIP_USED', 'This address already received gas')
    }
    if (times === 0 && dripped.size >= env.GAS_DRIP_MAX_TOTAL) {
      throw new HttpError(429, 'SPIKE_LIMIT', 'The gas drip limit for this server run is used up')
    }
    dripped.set(address, times + 1)
    const value = target - current
    const request = await wallet.prepareTransactionRequest({ to: address, value, ...fees })
    const serialized = await wallet.signTransaction(request)
    log.info({ address, wei: value.toString() }, 'sending gas drip')
    const result = await broadcastAndWait(serialized, log)
    const res: SpikeGasDripResponse = {
      status: 'sent',
      txHash: result.txHash,
      txStatus: result.status,
    }
    return c.json(res)
  })

  // Path B, step 2 is the user's own eth_sendTransaction; this reports how it landed.
  r.get('/tx/:hash', async (c) => {
    const hash = parseValue(hexSchema, c.req.param('hash'))
    if (hash.length !== 66) throw new HttpError(400, 'INVALID_REQUEST', 'Not a transaction hash')
    const receipt = await polygon.getTransactionReceipt({ hash }).catch(() => null)
    const res: SpikeTxResponse = { txHash: hash, status: receipt ? receipt.status : 'pending' }
    return c.json(res)
  })

  return r
}
