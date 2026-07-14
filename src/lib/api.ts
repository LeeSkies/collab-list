import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { AdminUser, Product, Profile } from './types'

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message)
  }
}

export function isProductConflict(reason: unknown): reason is ApiError {
  return reason instanceof ApiError && (reason.code === 'PT409' || reason.code === '40001')
}

type SupabaseResult<T> = {
  data: T | null
  error: { code?: string; message: string } | null
}

type AbortableRequest<T> = PromiseLike<SupabaseResult<T>> & {
  abortSignal?(signal: AbortSignal): PromiseLike<SupabaseResult<T>>
}

async function unwrap<T>(request: AbortableRequest<T>, externalSignal?: AbortSignal): Promise<T> {
  const controller = new AbortController()
  let timedOut = false
  const abortFromExternal = () => controller.abort(externalSignal?.reason)
  if (externalSignal?.aborted) abortFromExternal()
  else externalSignal?.addEventListener('abort', abortFromExternal, { once: true })
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, 12_000)

  try {
    const operation = request.abortSignal?.(controller.signal) ?? request
    const { data, error } = await operation
    if (error) throw new ApiError(error.code ?? 'unknown', error.message)
    if (data == null) throw new ApiError('empty', 'The server returned no data')
    return data
  } catch (reason) {
    if (timedOut) throw new ApiError('timeout', 'The request timed out')
    throw reason
  } finally {
    clearTimeout(timeout)
    externalSignal?.removeEventListener('abort', abortFromExternal)
  }
}

export const api = {
  products: {
    list: (signal?: AbortSignal) =>
      unwrap<Product[]>(
        supabase.from('products').select('*').order('ordering_at', { ascending: false }),
        signal
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
    create: (name: string, email: string, password: string) =>
      api.admin.invoke<{ user: AdminUser }>('create', { name, email, password }),
    remove: (userId: string) => api.admin.invoke<{ ok: true }>('delete', { userId })
  },
  realtime: {
    subscribe(onChange: () => void, onStatus: (status: string) => void): RealtimeChannel {
      return supabase
        .channel('shared-products')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, onChange)
        .subscribe(onStatus)
    }
  }
}
