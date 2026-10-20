import { META_TX_TYPES, USDT0_DOMAIN } from '@ferry/shared'
import {
  decodeFunctionData,
  encodeFunctionData,
  erc20Abi,
  isAddressEqual,
  parseSignature,
  recoverTypedDataAddress,
  type Address,
  type Hex,
} from 'viem'
import { HttpError } from './errors'

export interface MetaTxRequest {
  from: Address
  nonce: bigint
  functionSignature: Hex
  signature: Hex
}

export interface MetaTxExpectations {
  /** The only recipient the transfer may pay. */
  recipient: Address
  /** Exact amount, or an upper bound when `exact` is false. */
  amount: bigint
  exact: boolean
  /** getNonce(from) read from the chain just before verification. */
  onchainNonce: bigint
}

export interface VerifiedMetaTx {
  from: Address
  functionSignature: Hex
  to: Address
  amount: bigint
  r: Hex
  s: Hex
  v: number
}

export function encodeTransfer(to: Address, amount: bigint): Hex {
  return encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [to, amount] })
}

/**
 * Checks everything the relayer must know before spending gas: signer, nonce, and that the
 * signed call is exactly an ERC-20 transfer to the expected recipient for the expected amount.
 */
export async function verifyMetaTx(
  req: MetaTxRequest,
  expect: MetaTxExpectations,
): Promise<VerifiedMetaTx> {
  let decoded
  try {
    decoded = decodeFunctionData({ abi: erc20Abi, data: req.functionSignature })
  } catch {
    throw new HttpError(400, 'METATX_BAD_CALL', 'The signed call is not an ERC-20 call')
  }
  if (decoded.functionName !== 'transfer') {
    throw new HttpError(400, 'METATX_BAD_CALL', 'The signed call must be a transfer')
  }
  const [to, amount] = decoded.args
  if (!isAddressEqual(to, expect.recipient)) {
    throw new HttpError(400, 'METATX_BAD_RECIPIENT', 'The transfer goes to an unexpected address')
  }
  const amountOk = expect.exact ? amount === expect.amount : amount > 0n && amount <= expect.amount
  if (!amountOk) {
    throw new HttpError(400, 'METATX_BAD_AMOUNT', 'The transfer amount is not allowed')
  }
  if (req.nonce !== expect.onchainNonce) {
    throw new HttpError(409, 'METATX_STALE_NONCE', 'The signature uses an old nonce; sign again')
  }

  let signer: Address
  try {
    signer = await recoverTypedDataAddress({
      domain: USDT0_DOMAIN,
      types: META_TX_TYPES,
      primaryType: 'MetaTransaction',
      message: { nonce: req.nonce, from: req.from, functionSignature: req.functionSignature },
      signature: req.signature,
    })
  } catch {
    throw new HttpError(400, 'METATX_BAD_SIGNATURE', 'The signature could not be read')
  }
  if (!isAddressEqual(signer, req.from)) {
    throw new HttpError(400, 'METATX_WRONG_SIGNER', 'The signature does not match the sender')
  }

  const { r, s, v, yParity } = parseSignature(req.signature)
  const vNum = v !== undefined ? Number(v) : 27 + yParity
  return { from: req.from, functionSignature: req.functionSignature, to, amount, r, s, v: vNum }
}
