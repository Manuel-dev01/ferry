import { describe, expect, it, vi } from 'vitest'
import { createNimTracker } from '../src/lib/nimTracking'
import type { NimSwapState } from '../src/lib/nimSwap'

const state = (stage: NimSwapState['stage']): NimSwapState => ({
  stage,
  status: stage,
  claimTx: null,
  claimBy: null,
})
const entry = { id: 'pending', kind: 'nim', status: 'swapping', createdAt: Date.now(), mock: false }
function setup() {
  const deps = {
    entries: () => [entry],
    read: vi.fn(async () => state('waiting_payment')),
    claim: vi.fn(async () => 'claim-tx'),
    status: vi.fn(),
    report: vi.fn(async () => undefined),
  }
  return { deps, tracker: createNimTracker(deps) }
}

describe('app-wide NIM reconciliation', () => {
  it('continues across ticks without a progress screen and confirms actual completion', async () => {
    const { deps, tracker } = setup()
    deps.read
      .mockResolvedValueOnce(state('waiting_payment'))
      .mockResolvedValueOnce(state('ready'))
      .mockResolvedValueOnce(state('ready'))
      .mockResolvedValueOnce(state('done'))
    await tracker.tick()
    await tracker.tick()
    await tracker.tick()
    await tracker.tick()
    expect(deps.claim).toHaveBeenCalledTimes(1)
    expect(deps.status).toHaveBeenCalledExactlyOnceWith('pending', 'received')
    expect(deps.report).toHaveBeenCalledExactlyOnceWith('pending')
  })
  it('deduplicates concurrent timer, wake and history triggers', async () => {
    const { deps, tracker } = setup()
    let resolve!: (s: NimSwapState) => void
    deps.read.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r
        }),
    )
    const running = tracker.tick()
    await tracker.tick()
    expect(deps.read).toHaveBeenCalledTimes(1)
    resolve(state('ready'))
    await running
    expect(deps.claim).toHaveBeenCalledTimes(1)
  })
  it('a fresh tracker resumes a saved attempt; no ready status means no claim', async () => {
    const { deps, tracker } = setup()
    deps.read.mockResolvedValue(state('checking'))
    await tracker.tick()
    expect(deps.read).toHaveBeenCalledWith('pending')
    expect(deps.claim).not.toHaveBeenCalled()
    expect(deps.status).not.toHaveBeenCalled()
  })
  it('rechecks status after a claim error instead of resending a payment', async () => {
    const { deps, tracker } = setup()
    deps.read.mockResolvedValueOnce(state('ready')).mockResolvedValueOnce(state('done'))
    deps.claim.mockRejectedValueOnce(new Error('response lost'))
    await tracker.tick()
    await tracker.tick()
    expect(deps.read).toHaveBeenCalledTimes(2)
    expect(deps.claim).toHaveBeenCalledTimes(1)
    expect(deps.status).toHaveBeenCalledWith('pending', 'received')
  })
  it('does not turn an unavailable provider into a failed swap', async () => {
    const { deps, tracker } = setup()
    deps.read.mockRejectedValue(new Error('offline'))
    await tracker.tick()
    expect(deps.status).not.toHaveBeenCalled()
    expect(deps.claim).not.toHaveBeenCalled()
  })
  it('does not repeat an uncertain claim even if the provider still reports ready', async () => {
    const { deps, tracker } = setup()
    deps.read.mockResolvedValue(state('ready'))
    deps.claim.mockRejectedValue(new Error('relayer response lost'))
    await tracker.tick()
    await tracker.tick()
    expect(deps.read).toHaveBeenCalledTimes(2)
    expect(deps.claim).toHaveBeenCalledTimes(1)
    expect(deps.status).not.toHaveBeenCalled()
  })
  it('ignores mocks, other flows, terminal, old and future entries', async () => {
    const { deps } = setup()
    deps.entries = () => [
      { ...entry, mock: true },
      { ...entry, kind: 'topup' },
      { ...entry, status: 'failed' },
      { ...entry, status: 'received' },
      { ...entry, createdAt: 0 },
      { ...entry, createdAt: Date.now() + 60_000 },
    ]
    await createNimTracker(deps).tick()
    expect(deps.read).not.toHaveBeenCalled()
  })
  it('does not claim after teardown while a read is in flight', async () => {
    const { deps, tracker } = setup()
    let resolve!: (s: NimSwapState) => void
    deps.read.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r
        }),
    )
    const running = tracker.tick()
    tracker.stop()
    resolve(state('ready'))
    await running
    await tracker.tick()
    expect(deps.claim).not.toHaveBeenCalled()
    expect(deps.read).toHaveBeenCalledTimes(1)
  })
})
