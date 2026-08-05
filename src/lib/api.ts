import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type {
  AdminUser,
  BillingActionResult,
  BillingActionType,
  Category,
  DeletedHousehold,
  HouseholdCreation,
  HouseholdEntitlement,
  HouseholdInvite,
  HouseholdInvitePreview,
  HouseholdMembership,
  HouseholdRequestState,
  HouseholdSubscription,
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

export type AccountEmailErrorCode =
  'invalid_email' | 'duplicate_email' | 'email_rate_limited' | 'email_update_failed'

export class AccountEmailError extends ApiError {
  declare public code: AccountEmailErrorCode

  constructor(code: AccountEmailErrorCode, message: string) {
    super(code, message)
  }
}

export interface AccountEmailUpdateResult {
  email: string
  confirmationRequired: true
}

export type CategoryErrorCode =
  | 'duplicate'
  | 'invalid_name'
  | 'category_not_found'
  | 'cannot_delete_other'
  | 'admin_required'
  | 'default_category_missing'
  | 'household_read_only'
  | 'household_entitlement_locked'
  | 'category_failed'

export class CategoryError extends ApiError {
  declare public code: CategoryErrorCode

  constructor(code: CategoryErrorCode, message: string) {
    super(code, message)
  }
}

function categoryError(error: { code?: string; message: string }) {
  const message = error.message ?? ''
  if (error.code === '23505' || message.includes('categories_household_name_key')) {
    return new CategoryError('duplicate', 'A category with this name already exists')
  }
  if (error.code === '22023' || message === 'invalid_category_name') {
    return new CategoryError('invalid_name', 'Enter a category name between 1 and 80 characters')
  }
  if (error.code === 'P0002' || message === 'category_not_found') {
    return new CategoryError('category_not_found', 'That category no longer exists')
  }
  if (message === 'cannot_delete_other') {
    return new CategoryError('cannot_delete_other', "The other category can't be deleted")
  }
  if (message === 'admin_required') {
    return new CategoryError('admin_required', 'Only the household admin can delete categories')
  }
  if (message === 'default_category_missing') {
    return new CategoryError(
      'default_category_missing',
      'The household default category is missing'
    )
  }
  if (message === 'household_read_only') {
    return new CategoryError('household_read_only', message)
  }
  if (message === 'household_entitlement_locked') {
    return new CategoryError('household_entitlement_locked', message)
  }
  return new CategoryError('category_failed', message)
}

function categoryMutationError(reason: unknown): never {
  if (reason instanceof ApiError) throw categoryError(reason)
  throw reason
}

function accountEmailError(error: { code?: string; message: string; status?: number }) {
  const message = error.message.toLowerCase()
  if (
    error.code === 'email_exists' ||
    (error.status === 422 &&
      (message.includes('already been registered') ||
        message.includes('already registered') ||
        message.includes('already exists')))
  ) {
    return new AccountEmailError('duplicate_email', 'That email is already in use')
  }
  if (
    error.code === 'over_email_send_rate_limit' ||
    error.status === 429 ||
    message.includes('rate limit')
  ) {
    return new AccountEmailError('email_rate_limited', 'Too many email change requests')
  }
  if (
    error.code === 'email_address_invalid' ||
    error.status === 400 ||
    error.code === 'validation_failed'
  ) {
    return new AccountEmailError('invalid_email', 'Enter a valid email address')
  }
  return new AccountEmailError('email_update_failed', error.message)
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
  account: {
    updateEmail: async (email: string): Promise<AccountEmailUpdateResult> => {
      const normalizedEmail = email.trim().toLowerCase()
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        throw new AccountEmailError('invalid_email', 'Enter a valid email address')
      }
      const redirectTo =
        typeof window === 'undefined'
          ? undefined
          : new URL(import.meta.env.BASE_URL, window.location.origin).toString()
      const { data, error } = await supabase.auth.updateUser(
        { email: normalizedEmail },
        redirectTo ? { emailRedirectTo: redirectTo } : undefined
      )
      if (error) throw accountEmailError(error)
      if (!data.user) {
        throw new AccountEmailError('email_update_failed', 'The email change could not be started')
      }
      return { email: normalizedEmail, confirmationRequired: true }
    }
  },
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
          p_category_id: changes.category_id,
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
  categories: {
    list: (signal?: AbortSignal) =>
      unwrap<Category[]>(
        supabase.from('categories').select('*').order('name', { ascending: true }),
        signal
      ),
    create: async (name: string) => {
      try {
        const rows = await unwrap<Category[]>(supabase.rpc('create_category', { p_name: name }))
        return rows[0]!
      } catch (reason) {
        categoryMutationError(reason)
      }
    },
    remove: async (categoryId: string) => {
      try {
        await unwrap<boolean>(supabase.rpc('delete_category', { p_category_id: categoryId }))
      } catch (reason) {
        categoryMutationError(reason)
      }
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
    approveRequest: async (requestId: string, confirmAddOnCharge = false) => {
      const rows = await unwrap<Array<{ request_id: string; status: string }>>(
        supabase.rpc('approve_household_request', {
          p_request_id: requestId,
          p_confirm_add_on_charge: confirmAddOnCharge
        })
      )
      return rows[0]!
    },
    rejectRequest: async (requestId: string) => {
      const rows = await unwrap<Array<{ request_id: string; status: string }>>(
        supabase.rpc('reject_household_request', { p_request_id: requestId })
      )
      return rows[0]!
    },
    subscription: async () => {
      const rows = await unwrap<HouseholdSubscription[]>(
        supabase.rpc('current_household_subscription')
      )
      return rows[0]!
    },
    requestBillingAction: async (action: BillingActionType) => {
      const rows = await unwrap<
        Array<{
          action_id: string
          action: BillingActionType
          status: string
          created_at: string
        }>
      >(supabase.rpc('admin_request_billing_action', { p_action: action }))
      const result = rows[0]!
      return {
        actionId: result.action_id,
        action: result.action,
        status: result.status,
        createdAt: result.created_at
      } satisfies BillingActionResult
    },
    reset: async (clearProducts: boolean, removeMembers: boolean) => {
      const rows = await unwrap<Array<{ products_deleted: number; members_removed: number }>>(
        supabase.rpc('reset_household', {
          p_clear_products: clearProducts,
          p_remove_members: removeMembers
        })
      )
      return rows[0]!
    },
    delete: async (purgeNow: boolean) => {
      await unwrap<boolean>(supabase.rpc('delete_household', { p_purge_now: purgeNow }))
    },
    deleted: async () => {
      const rows = await unwrap<DeletedHousehold[]>(supabase.rpc('current_deleted_household'))
      return rows[0] ?? null
    },
    recover: async () => {
      await unwrap<boolean>(supabase.rpc('recover_deleted_household'))
    }
  },
  realtime: {
    subscribe(
      onChange: () => void,
      onStatus: (status: string) => void,
      householdId: string
    ): RealtimeChannel {
      if (!householdId) throw new ApiError('household_required', 'A household is required')
      const productChange = {
        event: '*' as const,
        schema: 'public' as const,
        table: 'products' as const,
        filter: `household_id=eq.${householdId}`
      }
      const categoryChange = {
        event: '*' as const,
        schema: 'public' as const,
        table: 'categories' as const,
        filter: `household_id=eq.${householdId}`
      }
      let productsSubscribed = false
      let categoriesSubscribed = false
      const statusFor = (kind: 'products' | 'categories') => (status: string) => {
        if (status === 'SUBSCRIBED') {
          if (kind === 'products') productsSubscribed = true
          else categoriesSubscribed = true
          if (productsSubscribed && categoriesSubscribed) onStatus('SUBSCRIBED')
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          onStatus(status)
        }
      }
      const productsChannel = supabase
        .channel(`household-products:${householdId}`)
        .on('postgres_changes', productChange, onChange)
        .subscribe(statusFor('products'))
      const categoriesChannel = supabase
        .channel(`household-categories:${householdId}`)
        .on('postgres_changes', categoryChange, onChange)
        .subscribe(statusFor('categories'))
      return {
        unsubscribe() {
          void productsChannel.unsubscribe()
          void categoriesChannel.unsubscribe()
        }
      } as unknown as RealtimeChannel
    }
  }
}
