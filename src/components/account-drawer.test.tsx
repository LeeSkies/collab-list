import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { api, AccountEmailError } from '../lib/api'
import { AccountDrawer } from './account-drawer'

const authState = vi.hoisted(() => ({
  profile: { email: 'old@example.com', role: 'member' as 'admin' | 'member' }
}))

vi.mock('../auth', () => ({
  useAuth: () => authState
}))

afterEach(() => {
  authState.profile.role = 'member'
  vi.restoreAllMocks()
})

function renderDrawer() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <I18nextProvider i18n={i18n}>
        <AccountDrawer open onOpenChange={vi.fn()} />
      </I18nextProvider>
    </QueryClientProvider>
  )
}

describe('AccountDrawer', () => {
  it.each(['member', 'admin'] as const)('offers own-email changes to a %s', async (role) => {
    authState.profile.role = role
    const user = userEvent.setup()
    const update = vi.spyOn(api.account, 'updateEmail').mockResolvedValue({
      email: 'new@example.com',
      confirmationRequired: true
    })

    renderDrawer()
    await user.clear(screen.getByRole('textbox', { name: 'New email' }))
    await user.type(screen.getByRole('textbox', { name: 'New email' }), 'new@example.com')
    await user.click(screen.getByRole('button', { name: 'Send confirmation email' }))

    await waitFor(() => expect(update.mock.calls[0]?.[0]).toBe('new@example.com'))
    expect(
      await screen.findByText(
        'Confirmation sent to new@example.com. Your current email remains active until you confirm.'
      )
    ).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'Current email' })).toHaveValue('old@example.com')
  })

  it('keeps the old address and explains a duplicate email failure', async () => {
    const user = userEvent.setup()
    vi.spyOn(api.account, 'updateEmail').mockRejectedValue(
      new AccountEmailError('duplicate_email', 'That email is already in use')
    )

    renderDrawer()
    await user.clear(screen.getByRole('textbox', { name: 'New email' }))
    await user.type(screen.getByRole('textbox', { name: 'New email' }), 'taken@example.com')
    await user.click(screen.getByRole('button', { name: 'Send confirmation email' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('That email is already in use.')
    expect(screen.getByRole('textbox', { name: 'Current email' })).toHaveValue('old@example.com')
  })
})
