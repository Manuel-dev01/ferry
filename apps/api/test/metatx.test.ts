import {
  buildMetaTxTypedData,
  EIP712_DOMAIN_TYPE,
  META_TX_TYPES,
  USDT0_DOMAIN,
  USDT0_DOMAIN_SEPARATOR,
} from '@ferry/shared'
import { encodeFunctionData, erc20Abi, hashDomain, type Hex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { describe, expect, it } from 'vitest'
import { HttpError } from '../src/errors'
import { encodeTransfer, verifyMetaTx } from '../src/metatx'

const user = privateKeyToAccount(generatePrivateKey())
const other = privateKeyToAccount(generatePrivateKey())
const recipient = '0x1111111111111111111111111111111111111111' as const
const ONE_USDT = 1_000_000n

async function sign(functionSignature: Hex, nonce = 7n, signer = user) {
  return signer.signTypedData({
    domain: USDT0_DOMAIN,
    types: META_TX_TYPES,
    primaryType: 'MetaTransaction',
    message: { nonce, from: user.address, functionSignature },
  })
}

const expectCode = async (p: Promise<unknown>, code: string) => {
  await expect(p).rejects.toBeInstanceOf(HttpError)
  await expect(p).rejects.toMatchObject({ code })
}

describe('USDT0 EIP-712 domain', () => {
  it('matches the on-chain DOMAIN_SEPARATOR', () => {
    const separator = hashDomain({
      domain: USDT0_DOMAIN,
      types: { EIP712Domain: EIP712_DOMAIN_TYPE },
    })
    expect(separator).toBe(USDT0_DOMAIN_SEPARATOR)
  })

  it('builds a wallet payload with an explicit EIP712Domain type', () => {
    const fn = encodeTransfer(recipient, ONE_USDT)
    const td = buildMetaTxTypedData({ nonce: '7', from: user.address, functionSignature: fn })
    expect(td.types.EIP712Domain.map((f) => f.name)).toEqual([
      'name',
      'version',
      'verifyingContract',
      'salt',
    ])
    expect(td.primaryType).toBe('MetaTransaction')
    expect(JSON.parse(JSON.stringify(td)).message.nonce).toBe('7')
  })
})

describe('verifyMetaTx', () => {
  const expectations = { recipient, amount: ONE_USDT, exact: false, onchainNonce: 7n }

  it('accepts a correctly signed transfer and splits the signature', async () => {
    const fn = encodeTransfer(recipient, 500_000n)
    const signature = await sign(fn)
    const tx = await verifyMetaTx(
      { from: user.address, nonce: 7n, functionSignature: fn, signature },
      expectations,
    )
    expect(tx.to.toLowerCase()).toBe(recipient)
    expect(tx.amount).toBe(500_000n)
    expect([27, 28]).toContain(tx.v)
    expect(tx.r).toMatch(/^0x[0-9a-f]{64}$/)
  })

  it('rejects a signature from someone else', async () => {
    const fn = encodeTransfer(recipient, ONE_USDT)
    const signature = await sign(fn, 7n, other)
    await expectCode(
      verifyMetaTx(
        { from: user.address, nonce: 7n, functionSignature: fn, signature },
        expectations,
      ),
      'METATX_WRONG_SIGNER',
    )
  })

  it('rejects other recipients, amounts over the cap, and stale nonces', async () => {
    const wrongTo = encodeTransfer(other.address, ONE_USDT)
    await expectCode(
      verifyMetaTx(
        {
          from: user.address,
          nonce: 7n,
          functionSignature: wrongTo,
          signature: await sign(wrongTo),
        },
        expectations,
      ),
      'METATX_BAD_RECIPIENT',
    )

    const tooMuch = encodeTransfer(recipient, ONE_USDT + 1n)
    await expectCode(
      verifyMetaTx(
        {
          from: user.address,
          nonce: 7n,
          functionSignature: tooMuch,
          signature: await sign(tooMuch),
        },
        expectations,
      ),
      'METATX_BAD_AMOUNT',
    )

    const fn = encodeTransfer(recipient, ONE_USDT)
    await expectCode(
      verifyMetaTx(
        { from: user.address, nonce: 6n, functionSignature: fn, signature: await sign(fn, 6n) },
        expectations,
      ),
      'METATX_STALE_NONCE',
    )
  })

  it('requires the exact amount when asked', async () => {
    const fn = encodeTransfer(recipient, 999_999n)
    await expectCode(
      verifyMetaTx(
        { from: user.address, nonce: 7n, functionSignature: fn, signature: await sign(fn) },
        { ...expectations, exact: true },
      ),
      'METATX_BAD_AMOUNT',
    )
  })

  it('rejects calls that are not transfers', async () => {
    const approve = encodeFunctionData({
      abi: erc20Abi,
      functionName: 'approve',
      args: [recipient, ONE_USDT],
    })
    await expectCode(
      verifyMetaTx(
        {
          from: user.address,
          nonce: 7n,
          functionSignature: approve,
          signature: await sign(approve),
        },
        expectations,
      ),
      'METATX_BAD_CALL',
    )
    await expectCode(
      verifyMetaTx(
        {
          from: user.address,
          nonce: 7n,
          functionSignature: '0xdeadbeef',
          signature: await sign('0xdeadbeef'),
        },
        expectations,
      ),
      'METATX_BAD_CALL',
    )
  })
})
