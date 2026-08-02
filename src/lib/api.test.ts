import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { channel, from, rpc } = vi.hoisted(() => ({
  channel: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn()
}))

vi.mock('./supabase', () => ({ supabase: { channel, from, rpc } }))

import { api, ApiError, isApiErrorCode, isProductConflict } from './api'

describe('profile.completeProductTour', () => {
  beforeEach(() => rpc.mockReset())

  it('marks the authenticated profile complete through the scoped RPC', async () => {
    rpc.mockResolvedValue({
      data: [{ product_tour_completed_at: '2026-08-05T12:00:00.000Z' }],
      error: null
    })

    await expect(api.profile.completeProductTour()).resolves.toBe('2026-08-05T12:00:00.000Z')
    expect(rpc).toHaveBeenCalledWith('complete_product_tour')
  })
})

describe('household.create', () => {
  beforeEach(() => rpc.mockReset())

  it('calls the atomic household and trial creation RPC', async () => {
    rpc.mockResolvedValue({
      data: [
        {
          household_id: 'household-id',
          household_name: "New Admin's household",
          trial_starts_at: '2026-08-02T00:00:00Z',
          trial_ends_at: '2026-08-16T00:00:00Z'
        }
      ],
      error: null
    })

    await expect(api.household.create()).resolves.toMatchObject({
      household_id: 'household-id',
      trial_ends_at: '2026-08-16T00:00:00Z'
    })
    expect(rpc).toHaveBeenCalledWith('create_household_with_trial')
  })
})

describe('products.update', () => {
  beforeEach(() => {
    channel.mockReset()
    from.mockReset()
    rpc.mockReset()
  })

  it('sends the category key through the versioned update RPC', async () => {
    rpc.mockResolvedValue({ data: [{ category: 'pantry' }], error: null })

    const result = await api.products.update(
      {
        household_id: '20000000-0000-0000-0000-000000000001',
        id: '10000000-0000-0000-0000-000000000003',
        name: 'Milk',
        name_signature: '4:milk',
        quantity: '2.00',
        notes: null,
        category: 'other',
        is_picked: false,
        picked_at: null,
        ordering_at: '2026-07-13T12:00:00.000Z',
        version: 7,
        created_by: '10000000-0000-0000-0000-000000000001',
        updated_by: '10000000-0000-0000-0000-000000000001',
        created_at: '2026-07-13T12:00:00.000Z',
        updated_at: '2026-07-13T12:00:00.000Z'
      },
      { name: 'Milk', quantity: '2.00', notes: '', category: 'pantry' }
    )

    expect(rpc).toHaveBeenCalledWith('update_product', {
      p_product_id: '10000000-0000-0000-0000-000000000003',
      p_name: 'Milk',
      p_quantity: '2.00',
      p_notes: '',
      p_category: 'pantry',
      p_expected_version: 7
    })
    expect(result).toMatchObject({ category: 'pantry' })
  })
})

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

describe('realtime subscription', () => {
  it('rejects a missing household ID instead of creating an unfiltered channel', () => {
    expect(() => api.realtime.subscribe(vi.fn(), vi.fn(), '' as never)).toThrow(
      'A household is required'
    )
    expect(channel).not.toHaveBeenCalled()
  })

  it('filters product changes to the current household', () => {
    const on = vi.fn().mockReturnThis()
    const subscribe = vi.fn()
    channel.mockReturnValue({ on, subscribe })

    api.realtime.subscribe(vi.fn(), vi.fn(), '20000000-0000-0000-0000-000000000001')

    expect(channel).toHaveBeenCalledWith('household-products:20000000-0000-0000-0000-000000000001')
    expect(on).toHaveBeenCalledWith(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'products',
        filter: 'household_id=eq.20000000-0000-0000-0000-000000000001'
      },
      expect.any(Function)
    )
  })
})

describe('isApiErrorCode', () => {
  it('matches both Postgres SQLSTATE and the RPC message', () => {
    expect(
      isApiErrorCode(
        new ApiError('42501', 'email_confirmation_required'),
        'email_confirmation_required'
      )
    ).toBe(true)
    expect(
      isApiErrorCode(
        new ApiError('P0001', 'household_capacity_reached'),
        'household_capacity_reached'
      )
    ).toBe(true)
    expect(isApiErrorCode(new ApiError('P0001', 'other'), 'household_capacity_reached')).toBe(false)
  })
})

describe('isProductConflict', () => {
  it('recognizes the HTTP 409 database code and the legacy serialization code', () => {
    expect(isProductConflict(new ApiError('PT409', 'product_conflict'))).toBe(true)
    expect(isProductConflict(new ApiError('40001', 'product_conflict'))).toBe(true)
    expect(isProductConflict(new ApiError('23505', 'duplicate'))).toBe(false)
  })
})
