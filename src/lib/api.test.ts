import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { auth, channel, from, rpc } = vi.hoisted(() => ({
  auth: { updateUser: vi.fn() },
  channel: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn()
}))

vi.mock('./supabase', () => ({ supabase: { auth, channel, from, rpc } }))

import { AccountEmailError, api, ApiError, isApiErrorCode, isProductConflict } from './api'

describe('account.updateEmail', () => {
  beforeEach(() => auth.updateUser.mockReset())

  it('starts Supabase Auth confirmation without changing application identity', async () => {
    auth.updateUser.mockResolvedValue({
      data: { user: { id: 'user-1', email: 'new@example.com' } },
      error: null
    })

    await expect(api.account.updateEmail(' New@Example.com ')).resolves.toEqual({
      email: 'new@example.com',
      confirmationRequired: true
    })
    expect(auth.updateUser).toHaveBeenCalledWith(
      { email: 'new@example.com' },
      expect.objectContaining({ emailRedirectTo: expect.any(String) })
    )
  })

  it('maps a duplicate Auth email to a typed error', async () => {
    auth.updateUser.mockResolvedValue({
      data: { user: null },
      error: {
        code: 'email_exists',
        message: 'A user with this email address has already been registered',
        status: 422
      }
    })

    await expect(api.account.updateEmail('taken@example.com')).rejects.toEqual(
      expect.objectContaining({ code: 'duplicate_email' })
    )
    await expect(api.account.updateEmail('not-an-email')).rejects.toBeInstanceOf(AccountEmailError)
  })

  it.each([
    ['email_address_invalid', 'invalid_email'],
    ['over_email_send_rate_limit', 'email_rate_limited']
  ] as const)('maps the Auth %s code to %s', async (code, expected) => {
    auth.updateUser.mockResolvedValue({
      data: { user: null },
      error: { code, message: code }
    })

    await expect(api.account.updateEmail('new@example.com')).rejects.toEqual(
      expect.objectContaining({ code: expected })
    )
  })
})

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

describe('household.entitlement', () => {
  beforeEach(() => rpc.mockReset())

  it('reads the authoritative access state and fixed seat allowance', async () => {
    rpc.mockResolvedValue({
      data: [
        {
          household_id: 'household-id',
          access_state: 'read_only_grace',
          trial_starts_at: '2026-08-01T00:00:00Z',
          trial_ends_at: '2026-08-15T00:00:00Z',
          grace_ends_at: '2026-08-22T00:00:00Z',
          seat_limit: 5,
          enforcement_enabled: true,
          can_mutate: false,
          reads_available: true
        }
      ],
      error: null
    })

    await expect(api.household.entitlement()).resolves.toMatchObject({
      access_state: 'read_only_grace',
      seat_limit: 5,
      reads_available: true
    })
    expect(rpc).toHaveBeenCalledWith('current_household_entitlement')
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

describe('household.reset', () => {
  beforeEach(() => rpc.mockReset())

  it('sends both reset choices to the destructive RPC', async () => {
    rpc.mockResolvedValue({
      data: [{ products_deleted: 3, members_removed: 2 }],
      error: null
    })

    await expect(api.household.reset(true, false)).resolves.toEqual({
      products_deleted: 3,
      members_removed: 2
    })
    expect(rpc).toHaveBeenCalledWith('reset_household', {
      p_clear_products: true,
      p_remove_members: false
    })
  })
})

describe('household.approveRequest', () => {
  beforeEach(() => rpc.mockReset())

  it('sends the explicit add-on charge confirmation', async () => {
    rpc.mockResolvedValue({ data: [{ request_id: 'req-1', status: 'approved' }], error: null })

    await expect(api.household.approveRequest('req-1', true)).resolves.toMatchObject({
      status: 'approved'
    })
    expect(rpc).toHaveBeenCalledWith('approve_household_request', {
      p_request_id: 'req-1',
      p_confirm_add_on_charge: true
    })
  })

  it('defaults to no add-on confirmation', async () => {
    rpc.mockResolvedValue({ data: [{ request_id: 'req-1', status: 'approved' }], error: null })

    await api.household.approveRequest('req-1')

    expect(rpc).toHaveBeenCalledWith('approve_household_request', {
      p_request_id: 'req-1',
      p_confirm_add_on_charge: false
    })
  })
})

describe('household.subscription', () => {
  beforeEach(() => rpc.mockReset())

  it('reads the authoritative subscription and seat state', async () => {
    rpc.mockResolvedValue({
      data: [
        {
          household_id: 'household-id',
          status: 'active',
          provider: 'stripe',
          provider_subscription_id: 'sub_123',
          current_period_start: '2026-08-01T00:00:00Z',
          current_period_end: '2026-08-31T00:00:00Z',
          grace_ends_at: '2026-09-07T00:00:00Z',
          cancel_at_period_end: false,
          canceled_at: null,
          base_seat_allowance: 5,
          add_on_seat_count: 2,
          add_on_unit_amount_minor_units: 990,
          currency: 'USD',
          provider_event_id: null,
          active_member_count: 7,
          billed_seat_count: 2,
          billing_enabled: true
        }
      ],
      error: null
    })

    await expect(api.household.subscription()).resolves.toMatchObject({
      status: 'active',
      base_seat_allowance: 5,
      add_on_seat_count: 2,
      billed_seat_count: 2,
      billing_enabled: true
    })
    expect(rpc).toHaveBeenCalledWith('current_household_subscription')
  })
})

describe('household.requestBillingAction', () => {
  beforeEach(() => rpc.mockReset())

  it('records the admin billing intent through the RPC', async () => {
    rpc.mockResolvedValue({
      data: [
        {
          action_id: 'act-1',
          action: 'cancel_at_period_end',
          status: 'pending',
          created_at: '2026-08-02T00:00:00Z'
        }
      ],
      error: null
    })

    await expect(api.household.requestBillingAction('cancel_at_period_end')).resolves.toEqual({
      actionId: 'act-1',
      action: 'cancel_at_period_end',
      status: 'pending',
      createdAt: '2026-08-02T00:00:00Z'
    })
    expect(rpc).toHaveBeenCalledWith('admin_request_billing_action', {
      p_action: 'cancel_at_period_end'
    })
  })
})

describe('request lifecycle normalization', () => {
  beforeEach(() => rpc.mockReset())

  it('throws a normalized empty response when an RPC returns no data', async () => {
    rpc.mockResolvedValue({ data: null, error: null })

    await expect(api.products.restoreAll(false, false)).rejects.toMatchObject({
      code: 'empty'
    })
  })

  it('normalizes a transport error to a typed ApiError with the reported code', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'not authorized' } })

    await expect(api.products.restoreAll(false, false)).rejects.toMatchObject({
      code: '42501',
      message: 'not authorized'
    })
    await expect(api.products.restoreAll(false, false)).rejects.toBeInstanceOf(ApiError)
  })

  it('falls back to a normalized unknown code when the DB error carries no code', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } })

    await expect(api.products.restoreAll(false, false)).rejects.toMatchObject({
      code: 'unknown'
    })
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
