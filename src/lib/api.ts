import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type {
  AdminUser,
  HouseholdCreation,
  HouseholdEntitlement,
  HouseholdInvite,
  HouseholdInvitePreview,
  HouseholdMembership,
  HouseholdRequestState,
  PendingHouseholdRequest,
  Product,
  ProductChanges,
  Profile
} from './types'

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

export function isApiErrorCode(reason: unknown, expected: string): reason is ApiError {
  return (
    reason instanceof ApiError &&
    (reason.code === expected || reason.message === expected || reason.message.includes(expected))
  )
}

type SupabaseResult<T> = {
  data: T | null
  error: { code?: string; message: string } | null
}

type AbortableRequest<T> = PromiseLike<SupabaseResult<T>> & {
  abortSignal?(signal: AbortSignal): PromiseLike<SupabaseResult<T>>
}

type AdminUserRow = {
  user_id: string
  name: string
  email: string
  role: AdminUser['role']
  created_at: string
}

function toAdminUser(row: AdminUserRow): AdminUser {
  return {
    id: row.user_id,
    name: row.name,
    email: row.email,
    role: row.role,
    createdAt: row.created_at
  }
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
    update: async (product: Product, changes: ProductChanges) => {
      const rows = await unwrap<Product[]>(
        supabase.rpc('update_product', {
          p_product_id: product.id,
          p_name: changes.name,
          p_quantity: changes.quantity,
          p_notes: changes.notes,
          p_category: changes.category,
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
      unwrap<Profile>(supabase.from('profiles').select('*').eq('id', id).single()),
    completeProductTour: async () => {
      const rows = await unwrap<Array<{ product_tour_completed_at: string }>>(
        supabase.rpc('complete_product_tour')
      )
      return rows[0]!.product_tour_completed_at
    }
  },
  household: {
    current: (userId: string) =>
      unwrap<HouseholdMembership>(
        supabase.from('household_members').select('*').eq('user_id', userId).single()
      ),
    create: async () => {
      const rows = await unwrap<HouseholdCreation[]>(supabase.rpc('create_household_with_trial'))
      return rows[0]!
    },
    entitlement: async () => {
      const rows = await unwrap<HouseholdEntitlement[]>(
        supabase.rpc('current_household_entitlement')
      )
      return rows[0]!
    },
    invite: async () => {
      const rows = await unwrap<Array<{ invite_token: string; expires_at: string }>>(
        supabase.rpc('invite_household_member')
      )
      return {
        token: rows[0]!.invite_token,
        expiresAt: rows[0]!.expires_at
      } satisfies HouseholdInvite
    },
    previewInvite: async (token: string) => {
      const rows = await unwrap<Array<{ household_name: string; approval_required: boolean }>>(
        supabase.rpc('preview_household_invite', { p_token: token })
      )
      const preview = rows[0]
      if (!preview) throw new ApiError('invite_invalid', 'Invite is invalid or expired')
      return {
        householdName: preview.household_name,
        approvalRequired: preview.approval_required
      } satisfies HouseholdInvitePreview
    },
    requestAccess: async (token: string) => {
      const rows = await unwrap<
        Array<{
          request_id: string | null
          household_name: string
          status: HouseholdRequestState['status']
          expires_at: string | null
        }>
      >(supabase.rpc('request_household_access', { p_token: token }))
      const request = rows[0]!
      return {
        requestId: request.request_id,
        householdName: request.household_name,
        status: request.status,
        expiresAt: request.expires_at
      } satisfies HouseholdRequestState
    },
    requestStatus: async (token: string) => {
      const rows = await unwrap<
        Array<{
          household_name: string
          status: HouseholdRequestState['status']
          expires_at: string | null
        }>
      >(supabase.rpc('current_household_invite_request', { p_token: token }))
      const request = rows[0]
      if (!request) throw new ApiError('request_not_found', 'No household request found')
      return {
        requestId: null,
        householdName: request.household_name,
        status: request.status,
        expiresAt: request.expires_at
      } satisfies HouseholdRequestState
    },
    pendingRequests: async (householdId: string) => {
      const rows = await unwrap<
        Array<{
          request_id: string
          name: string
          email: string
          requested_at: string
          expires_at: string
        }>
      >(supabase.rpc('list_pending_household_requests', { p_household_id: householdId }))
      return rows.map((request): PendingHouseholdRequest => ({
        requestId: request.request_id,
        name: request.name,
        email: request.email,
        requestedAt: request.requested_at,
        expiresAt: request.expires_at
      }))
    },
    members: async (householdId: string) => {
      const rows = await unwrap<AdminUserRow[]>(
        supabase.rpc('list_household_members', { p_household_id: householdId })
      )
      return rows.map(toAdminUser)
    },
    removeMember: async (householdId: string, userId: string) => {
      await unwrap<Array<{ user_id: string }>>(
        supabase.rpc('remove_household_member', {
          p_household_id: householdId,
          p_user_id: userId
        })
      )
    },
    approveRequest: async (requestId: string) => {
      const rows = await unwrap<Array<{ request_id: string; status: string }>>(
        supabase.rpc('approve_household_request', { p_request_id: requestId })
      )
      return rows[0]!
    },
    rejectRequest: async (requestId: string) => {
      const rows = await unwrap<Array<{ request_id: string; status: string }>>(
        supabase.rpc('reject_household_request', { p_request_id: requestId })
      )
      return rows[0]!
    },
    reset: async (clearProducts: boolean, removeMembers: boolean) => {
      const rows = await unwrap<Array<{ products_deleted: number; members_removed: number }>>(
        supabase.rpc('reset_household', {
          p_clear_products: clearProducts,
          p_remove_members: removeMembers
        })
      )
      return rows[0]!
    }
  },
  realtime: {
    subscribe(
      onChange: () => void,
      onStatus: (status: string) => void,
      householdId: string
    ): RealtimeChannel {
      if (!householdId) throw new ApiError('household_required', 'A household is required')
      const change = {
        event: '*' as const,
        schema: 'public' as const,
        table: 'products' as const,
        filter: `household_id=eq.${householdId}`
      }
      return supabase
        .channel(`household-products:${householdId}`)
        .on('postgres_changes', change, onChange)
        .subscribe(onStatus)
    }
  }
}
