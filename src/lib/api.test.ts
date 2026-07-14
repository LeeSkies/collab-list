import { beforeEach, describe, expect, it, vi } from 'vitest'

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))

vi.mock('./supabase', () => ({ supabase: { rpc } }))

import { api, ApiError, isProductConflict } from './api'

describe('products.restoreAll', () => {
  beforeEach(() => rpc.mockReset())

  it('sends both restore options to the atomic RPC', async () => {
    rpc.mockResolvedValue({ data: [], error: null })

    await api.products.restoreAll(true, false)

    expect(rpc).toHaveBeenCalledWith('restore_all_products', {
      p_clear_notes: true,
      p_reset_quantities: false
    })
  })
})

describe('isProductConflict', () => {
  it('recognizes the HTTP 409 database code and the legacy serialization code', () => {
    expect(isProductConflict(new ApiError('PT409', 'product_conflict'))).toBe(true)
    expect(isProductConflict(new ApiError('40001', 'product_conflict'))).toBe(true)
    expect(isProductConflict(new ApiError('23505', 'duplicate'))).toBe(false)
  })
})
