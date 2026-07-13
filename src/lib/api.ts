import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { AdminUser, PickHistory, Product, Profile } from './types'

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message)
  }
}

async function unwrap<T>(
  promise: PromiseLike<{ data: T | null; error: { code?: string; message: string } | null }>
): Promise<T> {
  const { data, error } = await Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new ApiError('timeout', 'The request timed out')), 12_000)
    )
  ])
  if (error) throw new ApiError(error.code ?? 'unknown', error.message)
  if (data == null) throw new ApiError('empty', 'The server returned no data')
  return data
}

export const api = {
  products: {
    list: () =>
      unwrap<Product[]>(
        supabase.from('products').select('*').order('ordering_at', { ascending: false })
      ),
    create: async (name: string) => {
      const rows = await unwrap<Product[]>(supabase.rpc('create_product', { p_name: name }))
      return rows[0]!
    },
    adjust: async (id: string, delta: 1 | -1, version: number) => {
      const rows = await unwrap<Product[]>(
        supabase.rpc('adjust_product_quantity', {
          p_product_id: id,
          p_delta: delta,
          p_expected_version: version
        })
      )
      return rows[0]!
    },
    toggle: async (product: Product) => {
      const rows = await unwrap<Product[]>(
        supabase.rpc('toggle_product_picked', {
          p_product_id: product.id,
          p_expected_version: product.version,
          p_expected_picked: product.is_picked
        })
      )
      return rows[0]!
    },
    restoreAll: (clearNotes: boolean, resetQuantities: boolean) =>
      unwrap<Product[]>(
        supabase.rpc('restore_all_products', {
          p_clear_notes: clearNotes,
          p_reset_quantities: resetQuantities
        })
      ),
    update: async (
      product: Product,
      changes: { name: string; quantity: string; notes: string }
    ) => {
      const rows = await unwrap<Product[]>(
        supabase.rpc('update_product', {
          p_product_id: product.id,
          p_name: changes.name,
          p_quantity: changes.quantity,
          p_notes: changes.notes,
          p_expected_version: product.version
        })
      )
      return rows[0]!
    },
    remove: async (product: Product) => {
      await unwrap<boolean>(
        supabase.rpc('delete_product', {
          p_product_id: product.id,
          p_expected_version: product.version
        })
      )
    }
  },
  history: {
    list: (productId: string) =>
      unwrap<PickHistory[]>(
        supabase
          .from('product_pick_history')
          .select('*')
          .eq('product_id', productId)
          .order('picked_at', { ascending: false })
          .order('id', { ascending: false })
      )
  },
  profile: {
    current: (id: string) =>
      unwrap<Profile>(supabase.from('profiles').select('*').eq('id', id).single())
  },
  admin: {
    invoke: async <T>(action: string, body?: Record<string, unknown>) => {
      const { data, error } = await supabase.functions.invoke('admin-users', {
        body: { action, ...body }
      })
      if (error) throw new ApiError('admin', error.message)
      if (data?.error) throw new ApiError(data.code ?? 'admin', data.error)
      return data as T
    },
    list: () => api.admin.invoke<{ users: AdminUser[] }>('list').then((value) => value.users),
    create: (email: string, password: string) =>
      api.admin.invoke<{ user: AdminUser }>('create', { email, password }),
    remove: (userId: string) => api.admin.invoke<{ ok: true }>('delete', { userId })
  },
  realtime: {
    subscribe(onChange: () => void, onStatus: (status: string) => void): RealtimeChannel {
      return supabase
        .channel('shared-products')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, onChange)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'product_pick_history' },
          onChange
        )
        .subscribe(onStatus)
    }
  }
}
