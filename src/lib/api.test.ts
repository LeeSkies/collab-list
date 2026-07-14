import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { from, rpc } = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }))

vi.mock('./supabase', () => ({ supabase: { from, rpc } }))

import { api, ApiError, isProductConflict } from './api'

describe('products.restoreAll', () => {
  beforeEach(() => {
    from.mockReset()
    rpc.mockReset()
  })
  afterEach(() => vi.useRealTimers())

  it('sends both restore options to the atomic RPC', async () => {
    rpc.mockResolvedValue({ data: [], error: null })

    await api.products.restoreAll(true, false)

    expect(rpc).toHaveBeenCalledWith('restore_all_products', {
      p_clear_notes: true,
      p_reset_quantities: false
    })
  })

  it('aborts an RPC that exceeds the request timeout', async () => {
    vi.useFakeTimers()
    const abortSignal = vi.fn(
      (signal: AbortSignal) =>
        new Promise<never>((_, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
        })
    )
    rpc.mockReturnValue({ abortSignal })

    const request = api.products.restoreAll(false, false)
    const rejection = expect(request).rejects.toMatchObject({ code: 'timeout' })
    await vi.advanceTimersByTimeAsync(12_000)

    await rejection
    expect(abortSignal).toHaveBeenCalledOnce()
    expect(abortSignal.mock.calls[0]?.[0].aborted).toBe(true)
  })
})

describe('products.list', () => {
  it('forwards React Query cancellation to the Supabase request', async () => {
    const abortSignal = vi.fn(
      (signal: AbortSignal) =>
        new Promise<never>((_, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
        })
    )
    const order = vi.fn(() => ({ abortSignal }))
    const select = vi.fn(() => ({ order }))
    from.mockReturnValue({ select })
    const controller = new AbortController()

    const request = api.products.list(controller.signal)
    controller.abort()

    await expect(request).rejects.toMatchObject({ name: 'AbortError' })
    expect(abortSignal).toHaveBeenCalledOnce()
    expect(abortSignal.mock.calls[0]?.[0].aborted).toBe(true)
  })
})

describe('isProductConflict', () => {
  it('recognizes the HTTP 409 database code and the legacy serialization code', () => {
    expect(isProductConflict(new ApiError('PT409', 'product_conflict'))).toBe(true)
    expect(isProductConflict(new ApiError('40001', 'product_conflict'))).toBe(true)
    expect(isProductConflict(new ApiError('23505', 'duplicate'))).toBe(false)
  })
})
