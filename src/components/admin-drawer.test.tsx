import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { api } from '../lib/api'
import { AdminDrawer } from './admin-drawer'

const authState = vi.hoisted(() => ({
  user: { id: 'admin-id' },
  profile: { household_id: 'household-a', role: 'admin' as 'admin' | 'member' }
}))

vi.mock('../auth', () => ({
  useAuth: () => authState
}))

afterEach(() => {
  authState.profile.role = 'admin'
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
    vi.spyOn(api.household, 'pendingRequests').mockResolvedValue([])
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
    vi.spyOn(api.household, 'members').mockResolvedValue([])
    vi.spyOn(api.household, 'pendingRequests').mockResolvedValue([])
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

  it('does not render admin controls for a regular member', () => {
    authState.profile.role = 'member'
    const members = vi.spyOn(api.household, 'members')
    const pendingRequests = vi.spyOn(api.household, 'pendingRequests')

    renderDrawer()

    expect(screen.queryByText('Invite a member')).not.toBeInTheDocument()
    expect(screen.queryByText('Pending requests')).not.toBeInTheDocument()
    expect(members).not.toHaveBeenCalled()
    expect(pendingRequests).not.toHaveBeenCalled()
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
    vi.spyOn(api.household, 'pendingRequests').mockResolvedValue([])

    renderDrawer(client)

    expect(await screen.findByText('Dana')).toBeVisible()
    expect(screen.queryByText('Other household member')).not.toBeInTheDocument()
    expect(client.getQueryData(['household-members'])).toBeUndefined()
    expect(client.getQueryData(['household-members', 'household-b'])).toBeDefined()
  })
})
