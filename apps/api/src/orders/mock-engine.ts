import {
  buildMetaTxTypedData,
  canTransition,
  maskAccount,
  type CorridorCurrency,
  type OfframpStatus,
  type OrderView,
  type QuoteAmounts,
} from '@ferry/shared'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { keccak256, type Address, type Hex, type PublicClient } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { HttpError } from '../errors'
import { encodeTransfer, verifyMetaTx } from '../metatx'
import { metaTxAbi } from '../polygon'

/** How long a quote/order can wait for a signature. Paycrest's refund timeout is 2 minutes. */
export const ORDER_VALID_MS = 90_000

/** Simulated settlement timeline after the signature, in ms. */
const MOCK_TIMELINE: [OfframpStatus, number][] = [
  ['deposited', 4_000],
  ['pending', 8_000],
  ['validated', 14_000],
  ['settled', 18_000],
]
/** Account numbers ending in 4040 get refunded instead, to exercise that screen. */
const MOCK_REFUND_TIMELINE: [OfframpStatus, number][] = [
  ['deposited', 4_000],
  ['pending', 8_000],
  ['refunded', 16_000],
]

export interface CreateOrderInput {
  currency: CorridorCurrency
  institution: string
  institutionName: string
  accountIdentifier: string
  evmAddress: Address
  rate: string
  quote: QuoteAmounts
}

interface MockOrder {
  view: OrderView
  secretHash: Buffer
  functionSignature: Hex
  nonce: bigint
  refundScenario: boolean
}

const newId = () => `fry_${randomBytes(10).toString('base64url')}`
const hashSecret = (secret: string) => createHash('sha256').update(secret).digest()

/**
 * Order engine used until a Paycrest key exists. It does everything the live engine will do
 * up to broadcasting (quote checks, typed data, real signature verification, state machine)
 * but never moves money: deposits and payouts are simulated on a timer.
 */
export class MockOrderEngine {
  private orders = new Map<string, MockOrder>()

  constructor(
    private readonly polygon: PublicClient,
    private readonly usdt: Address,
  ) {}

  async create(input: CreateOrderInput) {
    const nonce = await this.polygon
      .readContract({
        address: this.usdt,
        abi: metaTxAbi,
        functionName: 'getNonce',
        args: [input.evmAddress],
      })
      .catch(() => {
        throw new HttpError(503, 'RPC_UNAVAILABLE', "We couldn't reach the Polygon network")
      })

    // A throwaway address stands in for Paycrest's per-order receive address.
    const receiveAddress = privateKeyToAccount(generatePrivateKey()).address
    const amountToTransfer = input.quote.youSendUnits
    const functionSignature = encodeTransfer(receiveAddress, amountToTransfer)
    const now = Date.now()
    const clientSecret = randomBytes(32).toString('base64url')
    const view: OrderView = {
      id: newId(),
      kind: 'usdt_offramp',
      status: 'created',
      currency: input.currency,
      institutionName: input.institutionName,
      recipientMasked: maskAccount(input.accountIdentifier),
      amountUnits: input.quote.amountUnits.toString(),
      ferryFeeUnits: input.quote.ferryFeeUnits.toString(),
      amountToTransferUnits: amountToTransfer.toString(),
      theyReceiveMinor: input.quote.theyReceiveMinor.toString(),
      rate: input.rate,
      receiveAddress,
      refundAddress: input.evmAddress,
      validUntil: now + ORDER_VALID_MS,
      polygonTxHash: null,
      createdAt: now,
      settledAt: null,
      timeline: [{ status: 'created', at: now }],
      mock: true,
    }
    this.orders.set(view.id, {
      view,
      secretHash: hashSecret(clientSecret),
      functionSignature,
      nonce,
      refundScenario: input.accountIdentifier.endsWith('4040'),
    })
    const message = { nonce: nonce.toString(), from: input.evmAddress, functionSignature }
    return {
      orderId: view.id,
      clientSecret,
      order: view,
      signing: { mode: 'metatx' as const, typedData: buildMetaTxTypedData(message), message },
    }
  }

  private load(id: string, secret: string | undefined): MockOrder {
    const order = this.orders.get(id)
    const ok = order && secret && timingSafeEqual(order.secretHash, hashSecret(secret))
    if (!order || !ok) throw new HttpError(404, 'ORDER_NOT_FOUND', "We couldn't find that order")
    if (order.view.status === 'created' && Date.now() > order.view.validUntil) {
      this.move(order, 'expired')
    }
    return order
  }

  private move(order: MockOrder, to: OfframpStatus) {
    if (!canTransition(order.view.status as OfframpStatus, to)) return
    const at = Date.now()
    order.view.status = to
    order.view.timeline.push({ status: to, at })
    if (to === 'settled') order.view.settledAt = at
  }

  get(id: string, secret: string | undefined): OrderView {
    return this.load(id, secret).view
  }

  async submitSignature(
    id: string,
    secret: string | undefined,
    signature: Hex,
  ): Promise<OrderView> {
    const order = this.load(id, secret)
    if (order.view.status === 'expired') {
      throw new HttpError(409, 'ORDER_EXPIRED', 'This order expired before anything was sent')
    }
    if (order.view.status !== 'created') {
      throw new HttpError(409, 'ORDER_ALREADY_SIGNED', 'This order was already signed')
    }
    const from = order.view.refundAddress as Address
    const onchainNonce = await this.polygon.readContract({
      address: this.usdt,
      abi: metaTxAbi,
      functionName: 'getNonce',
      args: [from],
    })
    await verifyMetaTx(
      { from, nonce: order.nonce, functionSignature: order.functionSignature, signature },
      {
        recipient: order.view.receiveAddress as Address,
        amount: BigInt(order.view.amountToTransferUnits),
        exact: true,
        onchainNonce,
      },
    )
    this.move(order, 'signed')
    order.view.polygonTxHash = keccak256(signature) // stand-in; nothing is broadcast
    this.move(order, 'submitted')
    for (const [status, delay] of order.refundScenario ? MOCK_REFUND_TIMELINE : MOCK_TIMELINE) {
      setTimeout(() => this.move(order, status), delay).unref()
    }
    return order.view
  }
}
