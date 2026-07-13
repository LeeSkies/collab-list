import { beforeEach, describe, expect, it, vi } from 'vitest'

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))

vi.mock('./supabase', () => ({ supabase: { rpc } }))

import { api } from './api'

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
