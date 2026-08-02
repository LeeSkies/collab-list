import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { api, ApiError } from '../lib/api'
import { InviteHousehold } from './invite-household'

const { authState, realtimeChannel } = vi.hoisted(() => ({
  authState: {
    restoring: false,
    session: { user: { id: 'user-1' } },
    profile: {
      id: 'user-1',
      name: 'Lee',
      email: 'lee@example.com',
      role: 'member' as const,
      household_id: null,
      product_tour_completed_at: null
    },
    user: { id: 'user-1' },
    refreshProfile: vi.fn().mockResolvedValue(undefined),
    signOut: vi.fn()
  },
  realtimeChannel: vi.fn(() => ({
    on: vi.fn().mockReturnThis(),
    subscribe: vi.fn().mockReturnValue({ unsubscribe: vi.fn() }),
    unsubscribe: vi.fn()
  }))
}))

vi.mock('../auth', () => ({
  useAuth: () => authState
}))
vi.mock('../lib/supabase', () => ({
  supabase: { channel: realtimeChannel }
}))

afterEach(() => {
  sessionStorage.removeItem('pending-invite-token')
  vi.restoreAllMocks()
})

function renderInvite() {
  vi.spyOn(api.household, 'previewInvite').mockResolvedValue({
    householdName: 'The Cohens',
    approvalRequired: true
  })
  vi.spyOn(api.household, 'requestStatus').mockRejectedValue(
    new ApiError('request_not_found', 'No household request found')
  )
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <InviteHousehold token="invite-token" />
      </I18nextProvider>
    </QueryClientProvider>
  )
  return client
}

describe('InviteHousehold', () => {
  it('shows household-neutral copy instead of trial copy when a household blocks access', async () => {
    const user = userEvent.setup()
    const request = vi
      .spyOn(api.household, 'requestAccess')
      .mockRejectedValue(new ApiError('42501', 'household_read_only'))

    renderInvite()

    expect(await screen.findByText('Join The Cohens')).toBeVisible()
    await user.click(await screen.findByRole('button', { name: 'Request access' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This household is currently read-only. Please try again later.'
    )
    expect(screen.queryByText(/Your trial has ended/)).not.toBeInTheDocument()
    expect(request).toHaveBeenCalledWith('invite-token')
  })

  it('keeps the invite page free of subscription copy when the household is locked', async () => {
    const user = userEvent.setup()
    vi.spyOn(api.household, 'requestAccess').mockRejectedValue(
      new ApiError('42501', 'household_entitlement_locked')
    )

    renderInvite()

    await user.click(await screen.findByRole('button', { name: 'Request access' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This household is not accepting new members right now.'
    )
    expect(screen.queryByText(/Your trial has ended/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Your subscription has ended/)).not.toBeInTheDocument()
  })
})
