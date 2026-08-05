import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { api } from '../lib/api'
import type { Category } from '../lib/types'
import { SettingsDrawer } from './settings-drawer'

const authState = vi.hoisted(() => ({
  user: { id: 'admin-id' },
  profile: {
    household_id: 'household-a',
    role: 'admin' as 'admin' | 'member',
    email: 'old@example.com'
  },
  signOut: vi.fn().mockResolvedValue(undefined),
  refreshProfile: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('../auth', () => ({
  useAuth: () => authState
}))

const categories: Category[] = [
  { id: 'cat-other', household_id: 'household-a', name: 'other' },
  { id: 'cat-bakery', household_id: 'household-a', name: 'bakery' }
]

afterEach(async () => {
  authState.profile.role = 'admin'
  authState.signOut.mockReset().mockResolvedValue(undefined)
  vi.restoreAllMocks()
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  vi.spyOn(api.categories, 'list').mockResolvedValue(categories)
  vi.spyOn(api.household, 'members').mockResolvedValue([])
  vi.spyOn(api.household, 'pendingRequests').mockResolvedValue([])
  vi.spyOn(api.household, 'subscription').mockResolvedValue({
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
    billing_enabled: false
  })
  vi.spyOn(api.household, 'entitlement').mockResolvedValue({
    household_id: 'household-a',
    access_state: 'active_trial',
    trial_starts_at: '2026-08-01T12:00:00Z',
    trial_ends_at: '2026-08-15T12:00:00Z',
    grace_ends_at: '2026-08-22T12:00:00Z',
    seat_limit: 5,
    enforcement_enabled: true,
    can_mutate: true,
    reads_available: true
  })
})

function renderHub(
  open = true,
  onOpenChange = vi.fn(),
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  })
) {
  const view = render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <SettingsDrawer open={open} onOpenChange={onOpenChange} canMutate pendingRequestCount={2} />
      </I18nextProvider>
    </QueryClientProvider>
  )
  return { view, client, onOpenChange }
}

function translateX(element: Element | null) {
  const match = (element as HTMLElement | null)?.style.transform.match(/translateX\((-?[\d.]+)px\)/)
  return match ? Number(match[1]) : 0
}

describe('SettingsDrawer navigation', () => {
  it('shows the hub rows and the pending badge on the admin row', async () => {
    renderHub()

    expect(screen.getByRole('heading', { name: 'Settings' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Language' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Account' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Categories' })).toBeVisible()
    const adminRow = screen.getByRole('button', { name: /Users/ })
    expect(within(adminRow).getByText('2')).toBeVisible()
  })

  it('hides the admin row for a regular member', () => {
    authState.profile.role = 'member'
    renderHub()

    expect(screen.getByRole('button', { name: 'Categories' })).toBeVisible()
    expect(screen.queryByRole('button', { name: /Users/ })).not.toBeInTheDocument()
  })

  it('navigates into a sub-view, back to root, and resets to root when closed', async () => {
    const user = userEvent.setup()
    renderHub()

    await user.click(screen.getByRole('button', { name: 'Categories' }))
    expect(screen.getByRole('heading', { name: 'Categories' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Back' })).toBeVisible()
    // The outgoing root view stays mounted while its exit animation runs.
    expect(screen.getByRole('button', { name: 'Language' })).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Language' })).not.toBeInTheDocument()
    )

    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeVisible()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Language' })).toBeVisible())

    await user.click(screen.getByRole('button', { name: 'Categories' }))
    expect(screen.getByRole('heading', { name: 'Categories' })).toBeVisible()
  })

  it('keeps the outgoing view mounted while the incoming view transitions in', async () => {
    const user = userEvent.setup()
    renderHub()

    await user.click(screen.getByRole('button', { name: 'Account' }))
    expect(screen.getByRole('heading', { name: 'Account' })).toBeVisible()
    // Both views exist during the swap: the new one entering, the old one exiting.
    expect(screen.getByRole('button', { name: 'Categories' })).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Categories' })).not.toBeInTheDocument()
    )
  })

  it('slides the exiting and entering panels in opposite directions on back navigation', async () => {
    const user = userEvent.setup()
    renderHub()

    // Forward: root -> categories.
    await user.click(screen.getByRole('button', { name: 'Categories' }))
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Language' })).not.toBeInTheDocument()
    )

    // Back: categories -> root. The outgoing categories panel and the incoming
    // root panel must both use the back direction at transition time: root
    // slides in from the left while categories slides out to the right. (Before
    // the fix, the exiting panel kept the previous forward direction and both
    // panels travelled the same way.)
    await user.click(screen.getByRole('button', { name: 'Back' }))
    // Let the animations run a couple of frames past their start positions.
    await new Promise((resolve) => setTimeout(resolve, 40))

    const rootPanel = screen.getByRole('button', { name: 'Language' }).closest('.settings-view')
    const categoriesPanel = screen.getByRole('textbox').closest('.settings-view')
    expect(translateX(rootPanel)).toBeLessThan(0)
    expect(translateX(categoriesPanel)).toBeGreaterThan(0)
  })

  it('mirrors the travel direction under RTL on back navigation', async () => {
    await i18n.changeLanguage('he')
    expect(document.documentElement).toHaveAttribute('dir', 'rtl')
    const user = userEvent.setup()
    renderHub()

    // Forward: root -> categories. Under RTL the incoming panel enters from the
    // "next" side of the writing direction.
    await user.click(screen.getByRole('button', { name: 'קטגוריות' }))
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'שפה' })).not.toBeInTheDocument()
    )

    // Back: categories -> root. RTL mirrors the travel, so root slides in from
    // the right while categories slides out to the left.
    await user.click(screen.getByRole('button', { name: 'חזרה' }))
    await new Promise((resolve) => setTimeout(resolve, 40))

    const rootPanel = screen.getByRole('button', { name: 'שפה' }).closest('.settings-view')
    const categoriesPanel = screen.getByRole('textbox').closest('.settings-view')
    expect(translateX(rootPanel)).toBeGreaterThan(0)
    expect(translateX(categoriesPanel)).toBeLessThan(0)
  })

  it('resets to the root view after the drawer closes and reopens', async () => {
    const user = userEvent.setup()
    const { view } = renderHub()

    await user.click(screen.getByRole('button', { name: 'Categories' }))
    expect(screen.getByRole('heading', { name: 'Categories' })).toBeVisible()

    view.rerender(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <I18nextProvider i18n={i18n}>
          <SettingsDrawer open={false} onOpenChange={vi.fn()} canMutate pendingRequestCount={0} />
        </I18nextProvider>
      </QueryClientProvider>
    )
    view.rerender(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <I18nextProvider i18n={i18n}>
          <SettingsDrawer open onOpenChange={vi.fn()} canMutate pendingRequestCount={0} />
        </I18nextProvider>
      </QueryClientProvider>
    )

    expect(screen.getByRole('heading', { name: 'Settings' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Categories' })).toBeVisible()
  })

  it('moves focus to the back button on sub-views and back to the nav on root', async () => {
    const user = userEvent.setup()
    renderHub()

    await user.click(screen.getByRole('button', { name: 'Categories' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Back' })).toHaveFocus())

    await user.click(screen.getByRole('button', { name: 'Back' }))
    await waitFor(() => expect(document.querySelector('.settings-nav')).toHaveFocus())
  })
})

describe('SettingsDrawer language', () => {
  it('switches the app language from the language view', async () => {
    const user = userEvent.setup()
    renderHub()

    await user.click(screen.getByRole('button', { name: 'Language' }))
    expect(screen.getByRole('heading', { name: 'Language' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'עברית' }))

    await waitFor(() => expect(i18n.language).toBe('he'))
    expect(document.documentElement).toHaveAttribute('dir', 'rtl')
  })

  it('supports Arabic and French with the correct text direction', async () => {
    const user = userEvent.setup()
    renderHub()

    await user.click(screen.getByRole('button', { name: 'Language' }))
    await user.click(screen.getByRole('button', { name: 'العربية' }))

    await waitFor(() => expect(i18n.language).toBe('ar'))
    expect(document.documentElement).toHaveAttribute('dir', 'rtl')

    await user.click(screen.getByRole('button', { name: 'Français' }))
    await waitFor(() => expect(i18n.language).toBe('fr'))
    expect(document.documentElement).toHaveAttribute('dir', 'ltr')
  })
})

describe('SettingsDrawer embedded drawers', () => {
  it('embeds the account content and keeps the sign-out action', async () => {
    const user = userEvent.setup()
    renderHub()

    await user.click(screen.getByRole('button', { name: 'Account' }))
    expect(screen.getByRole('heading', { name: 'Account' })).toBeVisible()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Send confirmation email' })).toBeVisible()
    )

    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(authState.signOut).toHaveBeenCalledOnce())
  })

  it('gates the embedded admin queries to the active admin view', async () => {
    const user = userEvent.setup()
    const members = vi.spyOn(api.household, 'members')
    const pendingRequests = vi.spyOn(api.household, 'pendingRequests')
    renderHub()

    expect(screen.getByRole('heading', { name: 'Settings' })).toBeVisible()
    expect(members).not.toHaveBeenCalled()
    expect(pendingRequests).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: /Users/ }))
    expect(screen.getByRole('heading', { name: 'Users' })).toBeVisible()
    expect(await screen.findByRole('button', { name: 'Generate invite link' })).toBeVisible()
    await waitFor(() => expect(members).toHaveBeenCalledWith('household-a'))
    await waitFor(() => expect(pendingRequests).toHaveBeenCalledWith('household-a'))
  })
})
