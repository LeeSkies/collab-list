import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { api, ApiError } from '../lib/api'
import type { HouseholdEntitlement, HouseholdSubscription } from '../lib/types'
import { AdminDrawer } from './admin-drawer'

const authState = vi.hoisted(() => ({
  user: { id: 'admin-id' },
  profile: { household_id: 'household-a', role: 'admin' as 'admin' | 'member' },
  refreshProfile: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('../auth', () => ({
  useAuth: () => authState
}))

const futurePeriodEnd = new Date(Date.now() + 30 * 86_400_000).toISOString()

function defaultSubscription(
  overrides: Partial<HouseholdSubscription> = {}
): HouseholdSubscription {
  return {
    household_id: 'household-a',
    status: 'none',
    provider: null,
    provider_subscription_id: null,
    current_period_start: null,
    current_period_end: null,
    grace_ends_at: null,
    cancel_at_period_end: false,
    canceled_at: null,
    base_seat_allowance: 5,
    add_on_seat_count: 0,
    add_on_unit_amount_minor_units: null,
    currency: null,
    provider_event_id: null,
    active_member_count: 2,
    billed_seat_count: 0,
    billing_enabled: false,
    ...overrides
  }
}

function defaultEntitlement(overrides: Partial<HouseholdEntitlement> = {}): HouseholdEntitlement {
  return {
    household_id: 'household-a',
    access_state: 'active_trial',
    trial_starts_at: '2026-08-01T12:00:00Z',
    trial_ends_at: '2026-08-15T12:00:00Z',
    grace_ends_at: '2026-08-22T12:00:00Z',
    seat_limit: 5,
    enforcement_enabled: true,
    can_mutate: true,
    reads_available: true,
    ...overrides
  }
}

afterEach(() => {
  authState.profile.role = 'admin'
  authState.refreshProfile.mockReset().mockResolvedValue(undefined)
  vi.restoreAllMocks()
})

function renderDrawer(
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  })
) {
  render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <AdminDrawer open onOpenChange={vi.fn()} />
      </I18nextProvider>
    </QueryClientProvider>
  )
  return client
}

beforeEach(() => {
  vi.spyOn(api.household, 'members').mockResolvedValue([])
  vi.spyOn(api.household, 'pendingRequests').mockResolvedValue([])
  vi.spyOn(api.household, 'subscription').mockResolvedValue(defaultSubscription())
  vi.spyOn(api.household, 'entitlement').mockResolvedValue(defaultEntitlement())
})

describe('AdminDrawer', () => {
  it('does not expose the service-role create-user flow', async () => {
    const user = userEvent.setup()
    vi.spyOn(api.household, 'members').mockResolvedValue([
      {
        id: 'member-id',
        name: 'Dana',
        email: 'dana@example.com',
        role: 'member',
        createdAt: '2026-07-14T12:00:00.000Z'
      }
    ])
    const invite = vi.spyOn(api.household, 'invite').mockResolvedValue({
      token: 'invite-token',
      expiresAt: '2026-08-03T12:00:00.000Z'
    })

    const client = renderDrawer()

    expect(await screen.findByText('Dana')).toBeVisible()
    expect(screen.getByText('dana@example.com')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Create user' })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Password' })).not.toBeInTheDocument()
    expect(client.getQueryData(['household-members'])).toBeUndefined()
    await user.click(screen.getByRole('button', { name: 'Generate invite link' }))
    await waitFor(() => expect(invite).toHaveBeenCalledOnce())
  })

  it('requires a choice and explicit confirmation before resetting', async () => {
    const user = userEvent.setup()
    const reset = vi.spyOn(api.household, 'reset').mockResolvedValue({
      products_deleted: 2,
      members_removed: 1
    })

    renderDrawer()

    const resetButton = await screen.findByRole('button', { name: /^Reset household$/ })
    await user.click(resetButton)
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()

    await user.click(screen.getByRole('switch', { name: 'Delete all products and their history' }))
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByRole('heading', { name: 'Reset household now?' })).toBeVisible()
    expect(reset).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Reset now' }))
    await waitFor(() => expect(reset).toHaveBeenCalledWith(true, false))
  })

  it('requires fresh confirmation before deleting and removes the product cache', async () => {
    const user = userEvent.setup()
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
    })
    client.setQueryData(['products', 'household-a'], [{ id: 'stale-product' }])
    const removeHousehold = vi.spyOn(api.household, 'delete').mockResolvedValue(undefined)

    renderDrawer(client)

    await user.click(await screen.findByRole('button', { name: /^Delete household$/ }))
    const dialog = screen.getByRole('dialog', { name: 'Delete this household?' })
    const action = within(dialog).getByRole('button', { name: /^Delete household$/ })
    expect(action).toBeDisabled()
    await user.type(within(dialog).getByRole('textbox'), 'DELETE')
    expect(action).toBeEnabled()
    await user.click(action)

    await waitFor(() => expect(removeHousehold).toHaveBeenCalledWith(false))
    expect(client.getQueryData(['products', 'household-a'])).toBeUndefined()
  })

  it('does not render admin controls for a regular member', () => {
    authState.profile.role = 'member'
    const members = vi.spyOn(api.household, 'members')
    const pendingRequests = vi.spyOn(api.household, 'pendingRequests')
    const subscription = vi.spyOn(api.household, 'subscription')

    renderDrawer()

    expect(screen.queryByText('Invite a member')).not.toBeInTheDocument()
    expect(screen.queryByText('Pending requests')).not.toBeInTheDocument()
    expect(screen.queryByText('Plan')).not.toBeInTheDocument()
    expect(members).not.toHaveBeenCalled()
    expect(pendingRequests).not.toHaveBeenCalled()
    expect(subscription).not.toHaveBeenCalled()
  })

  it('does not reuse a member list cached for another household', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
    })
    client.setQueryData(
      ['household-members', 'household-b'],
      [
        {
          id: 'other-member',
          name: 'Other household member',
          email: 'other@example.com',
          role: 'member',
          createdAt: '2026-07-14T12:00:00.000Z'
        }
      ]
    )
    vi.spyOn(api.household, 'members').mockResolvedValue([
      {
        id: 'member-id',
        name: 'Dana',
        email: 'dana@example.com',
        role: 'member',
        createdAt: '2026-07-14T12:00:00.000Z'
      }
    ])

    renderDrawer(client)

    expect(await screen.findByText('Dana')).toBeVisible()
    expect(screen.queryByText('Other household member')).not.toBeInTheDocument()
    expect(client.getQueryData(['household-members'])).toBeUndefined()
    expect(client.getQueryData(['household-members', 'household-b'])).toBeDefined()
  })

  it('shows seats and keeps billing hidden while the feature flag is off', async () => {
    renderDrawer()

    expect(await screen.findByText('Plan')).toBeVisible()
    expect(await screen.findByText(/Free trial until \d{1,2} Aug 2026\./)).toBeVisible()
    expect(await screen.findByText('2 of 5 member seats used.')).toBeVisible()
    expect(screen.getByText('Billing is not available yet.')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Subscribe' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel at period end' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Resubscribe' })).not.toBeInTheDocument()
  })

  it('subscribes only after the admin confirms', async () => {
    const user = userEvent.setup()
    vi.spyOn(api.household, 'subscription').mockResolvedValue(
      defaultSubscription({ billing_enabled: true })
    )
    const request = vi.spyOn(api.household, 'requestBillingAction').mockResolvedValue({
      actionId: 'act-1',
      action: 'subscribe',
      status: 'pending',
      createdAt: '2026-08-02T00:00:00Z'
    })

    renderDrawer()

    await user.click(await screen.findByRole('button', { name: 'Subscribe' }))
    expect(screen.getByRole('heading', { name: 'Subscribe to the paid plan?' })).toBeVisible()
    expect(request).not.toHaveBeenCalled()

    const confirmDialog = screen.getByRole('dialog', { name: 'Subscribe to the paid plan?' })
    await user.click(within(confirmDialog).getByRole('button', { name: 'Subscribe' }))
    await waitFor(() => expect(request).toHaveBeenCalledWith('subscribe'))
    expect(
      screen.getByText('Request sent. The household updates when the payment provider confirms it.')
    ).toBeVisible()
  })

  it('confirms cancellation at period end for an active subscription', async () => {
    const user = userEvent.setup()
    vi.spyOn(api.household, 'subscription').mockResolvedValue(
      defaultSubscription({
        status: 'active',
        current_period_start: '2026-08-01T00:00:00Z',
        current_period_end: futurePeriodEnd,
        grace_ends_at: new Date(Date.now() + 37 * 86_400_000).toISOString(),
        billing_enabled: true
      })
    )
    const request = vi.spyOn(api.household, 'requestBillingAction').mockResolvedValue({
      actionId: 'act-2',
      action: 'cancel_at_period_end',
      status: 'pending',
      createdAt: '2026-08-02T00:00:00Z'
    })

    renderDrawer()

    await user.click(await screen.findByRole('button', { name: 'Cancel at period end' }))
    expect(
      screen.getByRole('heading', {
        name: 'Cancel the subscription at the end of the paid period?'
      })
    ).toBeVisible()

    const confirmDialog = screen.getByRole('dialog', {
      name: 'Cancel the subscription at the end of the paid period?'
    })
    await user.click(within(confirmDialog).getByRole('button', { name: 'Cancel at period end' }))
    await waitFor(() => expect(request).toHaveBeenCalledWith('cancel_at_period_end'))
  })

  it.each(['canceled', 'paused', 'past_due'] as const)(
    'does not offer cancellation for a future-period %s subscription',
    async (status) => {
      vi.spyOn(api.household, 'subscription').mockResolvedValue(
        defaultSubscription({
          status,
          current_period_start: '2026-08-01T00:00:00Z',
          current_period_end: futurePeriodEnd,
          grace_ends_at: new Date(Date.now() + 37 * 86_400_000).toISOString(),
          billing_enabled: true
        })
      )

      renderDrawer()

      expect(await screen.findByRole('button', { name: 'Resubscribe' })).toBeVisible()
      expect(screen.queryByRole('button', { name: 'Cancel at period end' })).not.toBeInTheDocument()
      expect(screen.queryByText(/Paid plan active until/)).not.toBeInTheDocument()
      expect(
        screen.getByText('Subscription requires attention. Resubscribe to restore the paid plan.')
      ).toBeVisible()
    }
  )

  it('offers resubscribe after cancellation and shows the exact add-on charge line', async () => {
    const user = userEvent.setup()
    vi.spyOn(api.household, 'subscription').mockResolvedValue(
      defaultSubscription({
        status: 'active',
        current_period_start: '2026-08-01T00:00:00Z',
        current_period_end: futurePeriodEnd,
        grace_ends_at: new Date(Date.now() + 37 * 86_400_000).toISOString(),
        cancel_at_period_end: true,
        add_on_seat_count: 1,
        add_on_unit_amount_minor_units: 990,
        currency: 'USD',
        provider_event_id: null,
        active_member_count: 6,
        billed_seat_count: 1,
        billing_enabled: true
      })
    )
    const request = vi.spyOn(api.household, 'requestBillingAction').mockResolvedValue({
      actionId: 'act-3',
      action: 'resubscribe',
      status: 'pending',
      createdAt: '2026-08-02T00:00:00Z'
    })

    renderDrawer()

    expect(await screen.findByText(/add-on seat at .*9\.90/)).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Resubscribe' }))
    expect(screen.getByRole('heading', { name: 'Resubscribe the household?' })).toBeVisible()

    const confirmDialog = screen.getByRole('dialog', { name: 'Resubscribe the household?' })
    await user.click(within(confirmDialog).getByRole('button', { name: 'Resubscribe' }))
    await waitFor(() => expect(request).toHaveBeenCalledWith('resubscribe'))
  })

  it('shows the exact recurring add-on charge and requires confirmation before approving beyond five', async () => {
    const user = userEvent.setup()
    vi.spyOn(api.household, 'subscription').mockResolvedValue(
      defaultSubscription({
        status: 'active',
        current_period_start: '2026-08-01T00:00:00Z',
        current_period_end: futurePeriodEnd,
        grace_ends_at: new Date(Date.now() + 37 * 86_400_000).toISOString(),
        add_on_seat_count: 1,
        add_on_unit_amount_minor_units: 990,
        currency: 'USD',
        provider_event_id: null,
        active_member_count: 6,
        billed_seat_count: 1,
        billing_enabled: true
      })
    )
    vi.spyOn(api.household, 'pendingRequests').mockResolvedValue([
      {
        requestId: 'req-1',
        name: 'Dana',
        email: 'dana@example.com',
        requestedAt: '2026-08-01T00:00:00Z',
        expiresAt: '2026-08-08T00:00:00Z'
      }
    ])
    const approve = vi.spyOn(api.household, 'approveRequest').mockResolvedValue({
      request_id: 'req-1',
      status: 'approved'
    })

    renderDrawer()

    await user.click(await screen.findByRole('button', { name: 'Approve Dana' }))
    expect(
      screen.getByRole('heading', { name: 'Approve Dana with an add-on charge?' })
    ).toBeVisible()
    expect(screen.getByText(/recurring charge of .*9\.90/)).toBeVisible()
    expect(approve).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(approve).toHaveBeenCalledWith('req-1', true))
  })

  it('shows the server explanation when the add-on charge is not configured', async () => {
    const user = userEvent.setup()
    vi.spyOn(api.household, 'subscription').mockResolvedValue(
      defaultSubscription({
        status: 'active',
        current_period_start: '2026-08-01T00:00:00Z',
        current_period_end: futurePeriodEnd,
        grace_ends_at: new Date(Date.now() + 37 * 86_400_000).toISOString(),
        add_on_seat_count: 1,
        add_on_unit_amount_minor_units: null,
        currency: null,
        provider_event_id: null,
        active_member_count: 6,
        billed_seat_count: 1,
        billing_enabled: true
      })
    )
    vi.spyOn(api.household, 'pendingRequests').mockResolvedValue([
      {
        requestId: 'req-1',
        name: 'Dana',
        email: 'dana@example.com',
        requestedAt: '2026-08-01T00:00:00Z',
        expiresAt: '2026-08-08T00:00:00Z'
      }
    ])
    const approve = vi
      .spyOn(api.household, 'approveRequest')
      .mockRejectedValue(new ApiError('P0001', 'add_on_charge_not_configured'))

    renderDrawer()

    await user.click(await screen.findByRole('button', { name: 'Approve Dana' }))
    await waitFor(() => expect(approve).toHaveBeenCalledWith('req-1', false))
    expect(
      screen.getByText(
        'The added-seat charge is not configured yet. Complete the payment setup before approving.'
      )
    ).toBeVisible()
  })

  it('uses paid-specific copy for an invite rejected on a paid read-only boundary', async () => {
    const user = userEvent.setup()
    vi.spyOn(api.household, 'subscription').mockResolvedValue(
      defaultSubscription({
        status: 'canceled',
        current_period_start: '2026-07-01T00:00:00Z',
        current_period_end: '2026-07-31T00:00:00Z',
        grace_ends_at: '2026-08-07T00:00:00Z',
        cancel_at_period_end: true,
        canceled_at: '2026-07-20T00:00:00Z',
        billing_enabled: true
      })
    )
    vi.spyOn(api.household, 'entitlement').mockResolvedValue(
      defaultEntitlement({
        access_state: 'read_only_grace',
        trial_starts_at: null,
        trial_ends_at: null,
        can_mutate: false
      })
    )
    const invite = vi
      .spyOn(api.household, 'invite')
      .mockRejectedValue(new ApiError('42501', 'household_read_only'))

    renderDrawer()

    await user.click(await screen.findByRole('button', { name: 'Generate invite link' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your subscription has ended. The list is available to read during the seven-day grace period.'
    )
    expect(invite).toHaveBeenCalled()
  })

  it('keeps trial-specific copy for an invite rejected on a trial read-only boundary', async () => {
    const user = userEvent.setup()
    vi.spyOn(api.household, 'subscription').mockResolvedValue(
      defaultSubscription({ billing_enabled: false })
    )
    vi.spyOn(api.household, 'entitlement').mockResolvedValue(
      defaultEntitlement({
        access_state: 'read_only_grace',
        can_mutate: false
      })
    )
    vi.spyOn(api.household, 'invite').mockRejectedValue(
      new ApiError('42501', 'household_read_only')
    )

    renderDrawer()

    await user.click(await screen.findByRole('button', { name: 'Generate invite link' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your trial has ended. The list is available to read during the seven-day grace period.'
    )
  })
})
