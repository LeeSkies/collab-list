import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { api } from '../lib/api'
import { AdminDrawer } from './admin-drawer'

vi.mock('../auth', () => ({
  useAuth: () => ({ user: { id: 'admin-id' } })
}))

afterEach(() => {
  vi.restoreAllMocks()
})

function renderDrawer() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  })
  render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <AdminDrawer open onOpenChange={vi.fn()} />
      </I18nextProvider>
    </QueryClientProvider>
  )
}

describe('AdminDrawer', () => {
  it('requires a display name when creating a user and lists it above the email', async () => {
    const user = userEvent.setup()
    vi.spyOn(api.admin, 'list').mockResolvedValue([
      {
        id: 'member-id',
        name: 'Dana',
        email: 'dana@example.com',
        role: 'member',
        createdAt: '2026-07-14T12:00:00.000Z'
      }
    ])
    const create = vi.spyOn(api.admin, 'create').mockResolvedValue({
      user: {
        id: 'new-member-id',
        name: 'Noa',
        email: 'noa@example.com',
        role: 'member',
        createdAt: '2026-07-14T13:00:00.000Z'
      }
    })

    renderDrawer()

    const name = screen.getByRole('textbox', { name: 'Name' })
    expect(name).toBeRequired()
    expect(name).toHaveAttribute('maxlength', '80')
    expect(await screen.findByText('Dana')).toBeVisible()
    expect(screen.getByText('dana@example.com')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Create user' })).toHaveClass('button')

    await user.type(name, 'Noa')
    await user.type(screen.getByRole('textbox', { name: 'Email' }), 'noa@example.com')
    await user.type(screen.getByLabelText('Password'), 'password123')
    await user.click(screen.getByRole('button', { name: 'Create user' }))

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith('Noa', 'noa@example.com', 'password123')
    )
  })
})
