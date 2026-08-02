import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'

const { authState, createHousehold } = vi.hoisted(() => ({
  authState: {
    session: null as object | null,
    signUp: vi.fn(),
    refreshProfile: vi.fn()
  },
  createHousehold: vi.fn()
}))

vi.mock('../auth', () => ({ useAuth: () => authState }))
vi.mock('../lib/api', () => ({ api: { household: { create: createHousehold } } }))

import { CreateHouseholdOnboarding } from './create-household-onboarding'

function renderOnboarding() {
  return render(
    <I18nextProvider i18n={i18n}>
      <CreateHouseholdOnboarding />
    </I18nextProvider>
  )
}

afterEach(() => {
  authState.session = null
  authState.signUp.mockReset()
  authState.refreshProfile.mockReset()
  createHousehold.mockReset()
})

describe('CreateHouseholdOnboarding', () => {
  it('explains the shared list and keeps the household uncreated until final confirmation', async () => {
    const user = userEvent.setup()
    authState.signUp.mockResolvedValue({ confirmationRequired: true })
    renderOnboarding()

    expect(screen.getByRole('heading', { name: 'A shared list for your household' })).toBeVisible()
    expect(screen.getByText('You will be the household admin.')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Create my account' }))
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'New Admin')
    await user.type(screen.getByRole('textbox', { name: 'Email' }), 'new@example.com')
    await user.type(document.querySelector('input[type="password"]')!, 'password123')
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    expect(await screen.findByRole('heading', { name: 'Confirm your email' })).toBeVisible()
    expect(screen.getByText('Your household and trial are not created yet.')).toBeVisible()
    expect(createHousehold).not.toHaveBeenCalled()
  })

  it('moves focus to and announces each new step heading', async () => {
    const user = userEvent.setup()
    renderOnboarding()

    await user.click(screen.getByRole('button', { name: 'Create my account' }))
    const heading = await screen.findByRole('heading', { name: 'Create your admin account' })

    await waitFor(() => expect(document.activeElement).toBe(heading))
    expect(document.querySelector('[aria-live="polite"]')).toHaveTextContent(
      'Create your admin account'
    )
  })

  it('shows the trial confirmation after verification and creates atomically on explicit confirmation', async () => {
    const user = userEvent.setup()
    authState.session = { user: { id: 'new-user' } }
    createHousehold.mockResolvedValue({
      household_id: 'household-id',
      household_name: "New Admin's household",
      trial_starts_at: '2026-08-02T00:00:00Z',
      trial_ends_at: '2026-08-16T00:00:00Z'
    })
    renderOnboarding()

    expect(screen.getByRole('heading', { name: 'Start your free trial?' })).toBeVisible()
    expect(screen.getByText('No payment details required.')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Create household and start trial' }))

    await waitFor(() => expect(createHousehold).toHaveBeenCalledOnce())
    expect(authState.refreshProfile).not.toHaveBeenCalled()
    expect(await screen.findByRole('heading', { name: 'Your household is ready' })).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Continue to list' }))
    await waitFor(() => expect(authState.refreshProfile).toHaveBeenCalledOnce())
  })

  it('keeps the completion screen and retries profile refresh without recreating the household', async () => {
    const user = userEvent.setup()
    authState.session = { user: { id: 'new-user' } }
    createHousehold.mockResolvedValue({
      household_id: 'household-id',
      household_name: "New Admin's household",
      trial_starts_at: '2026-08-02T00:00:00Z',
      trial_ends_at: '2026-08-16T00:00:00Z'
    })
    authState.refreshProfile
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValueOnce(undefined)
    renderOnboarding()

    await user.click(screen.getByRole('button', { name: 'Create household and start trial' }))
    await screen.findByRole('heading', { name: 'Your household is ready' })
    await user.click(screen.getByRole('button', { name: 'Continue to list' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your household was created, but we could not open the list.'
    )
    expect(screen.getByRole('heading', { name: 'Your household is ready' })).toBeVisible()
    expect(createHousehold).toHaveBeenCalledOnce()

    await user.click(screen.getByRole('button', { name: 'Continue to list' }))
    await waitFor(() => expect(authState.refreshProfile).toHaveBeenCalledTimes(2))
    expect(createHousehold).toHaveBeenCalledOnce()
  })
})
