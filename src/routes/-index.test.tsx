import type { ComponentType } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'

const { authState } = vi.hoisted(() => ({
  authState: {
    restoring: true,
    session: null,
    user: null,
    profile: null
  }
}))

vi.mock('../auth', () => ({
  useAuth: () => authState
}))

vi.mock('../lib/supabase', () => ({
  isSupabaseConfigured: true
}))

vi.mock('../lib/api', () => ({
  api: {
    household: {
      deleted: vi.fn().mockResolvedValue(null)
    }
  }
}))

vi.mock('../components/create-household-onboarding', () => ({
  CreateHouseholdOnboarding: () => <div>onboarding</div>
}))
vi.mock('../components/deleted-household-screen', () => ({
  DeletedHouseholdScreen: () => <div>deleted</div>
}))
vi.mock('../components/grocery-app', () => ({
  GroceryApp: () => <div>groceries</div>
}))
vi.mock('../components/login-form', () => ({
  LoginForm: () => <div>login</div>
}))

import { Route } from './index'

const Home = (Route.options as { component: ComponentType }).component

function renderHome() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <Home />
      </I18nextProvider>
    </QueryClientProvider>
  )
}

describe('home route startup', () => {
  beforeEach(() => {
    authState.restoring = true
  })

  it('keeps the branded startup screen visible while auth restores', () => {
    renderHome()

    expect(screen.getByRole('status', { name: i18n.t('loading') })).toBeVisible()
  })
})
