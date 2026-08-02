import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { api, ApiError } from '../lib/api'
import { PRODUCT_CATEGORIES } from '../lib/product-category'
import type { Product } from '../lib/types'
import { GroceryApp } from './grocery-app'
import { ProductSection } from './product-section'

const { authState } = vi.hoisted(() => ({
  authState: {
    profile: {
      role: 'member' as 'admin' | 'member',
      household_id: '20000000-0000-0000-0000-000000000001',
      product_tour_completed_at: undefined as string | null | undefined
    },
    refreshProfile: vi.fn().mockResolvedValue(undefined),
    signOut: vi.fn()
  }
}))

vi.mock('../auth', () => ({
  useAuth: () => authState
}))

const boughtProduct: Product = {
  household_id: '20000000-0000-0000-0000-000000000001',
  id: '10000000-0000-0000-0000-000000000003',
  name: 'Milk',
  name_signature: '4:milk',
  quantity: '1.00',
  notes: null,
  category: 'other',
  is_picked: true,
  picked_at: '2026-07-13T12:00:00.000Z',
  ordering_at: '2026-07-13T12:00:00.000Z',
  version: 1,
  created_by: '10000000-0000-0000-0000-000000000001',
  updated_by: '10000000-0000-0000-0000-000000000001',
  created_at: '2026-07-13T12:00:00.000Z',
  updated_at: '2026-07-13T12:00:00.000Z'
}

const newProduct: Product = {
  ...boughtProduct,
  id: '10000000-0000-0000-0000-000000000004',
  name: 'Bread',
  name_signature: '5:bread',
  is_picked: false,
  picked_at: null
}

function buildProductSection(
  products: Product[],
  enteringProductIds: ReadonlySet<string> = new Set()
) {
  return (
    <I18nextProvider i18n={i18n}>
      <ProductSection
        title="Bought"
        products={products}
        enteringProductIds={enteringProductIds}
        showCount={false}
        headerAction={<button aria-label="Restore all" />}
        duplicatePulse=""
        onEdit={vi.fn()}
        onAdjust={vi.fn()}
        onToggle={vi.fn()}
      />
    </I18nextProvider>
  )
}

afterEach(async () => {
  authState.profile = {
    role: 'member',
    household_id: '20000000-0000-0000-0000-000000000001',
    product_tour_completed_at: undefined
  }
  localStorage.removeItem('grocery-sort-mode')
  await i18n.changeLanguage('en')
  authState.refreshProfile.mockReset().mockResolvedValue(undefined)
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('GroceryApp account access', () => {
  it('opens the account drawer for regular members', async () => {
    const user = userEvent.setup()
    vi.spyOn(api.products, 'list').mockResolvedValue([boughtProduct])
    vi.spyOn(api.realtime, 'subscribe').mockReturnValue({ unsubscribe: vi.fn() } as never)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    render(
      <QueryClientProvider client={client}>
        <I18nextProvider i18n={i18n}>
          <GroceryApp />
        </I18nextProvider>
      </QueryClientProvider>
    )

    await user.click(await screen.findByRole('button', { name: 'Account' }))
    expect(screen.getByRole('heading', { name: 'Account' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Send confirmation email' })).toBeVisible()
  })
})

describe('GroceryApp sorting', () => {
  it('selects a sort mode from a compact menu and restores the persisted mode', async () => {
    const user = userEvent.setup()
    await i18n.changeLanguage('en')
    vi.spyOn(api.products, 'list').mockResolvedValue([newProduct, boughtProduct])
    vi.spyOn(api.realtime, 'subscribe').mockReturnValue({ unsubscribe: vi.fn() } as never)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    const view = render(
      <QueryClientProvider client={client}>
        <I18nextProvider i18n={i18n}>
          <GroceryApp />
        </I18nextProvider>
      </QueryClientProvider>
    )

    const sort = await screen.findByRole('button', { name: 'Sort: Default' })
    expect(sort).not.toHaveTextContent('Default')
    expect(sort).not.toHaveClass('is-active')

    fireEvent.mouseDown(sort)
    await user.click(await screen.findByRole('menuitemradio', { name: 'Name' }))
    expect(screen.getByRole('button', { name: 'Sort: Name' })).toHaveClass('is-active')
    expect(localStorage.getItem('grocery-sort-mode')).toBe('name')

    view.unmount()
    const nextClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={nextClient}>
        <I18nextProvider i18n={i18n}>
          <GroceryApp />
        </I18nextProvider>
      </QueryClientProvider>
    )

    const restored = await screen.findByRole('button', { name: 'Sort: Name' })
    fireEvent.mouseDown(restored)
    expect(await screen.findByRole('menuitemradio', { name: 'Name' })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    await user.click(screen.getByRole('menuitemradio', { name: 'Category' }))
    expect(screen.getByRole('button', { name: 'Sort: Category' })).toBeVisible()
  })

  it('shows only populated category groups and sorts names within each top-level section', async () => {
    await i18n.changeLanguage('en')
    localStorage.setItem('grocery-sort-mode', 'category')
    const products: Product[] = [
      { ...newProduct, id: 'snacks-zebra', name: 'Zebra', category: 'snacks' },
      { ...newProduct, id: 'dairy-milk', name: 'Milk', category: 'dairy_eggs' },
      { ...newProduct, id: 'snacks-apple', name: 'apple', category: 'snacks' },
      { ...boughtProduct, id: 'bakery-bread', name: 'Bread', category: 'bakery' }
    ]
    vi.spyOn(api.products, 'list').mockResolvedValue(products)
    vi.spyOn(api.realtime, 'subscribe').mockReturnValue({ unsubscribe: vi.fn() } as never)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    render(
      <QueryClientProvider client={client}>
        <I18nextProvider i18n={i18n}>
          <GroceryApp />
        </I18nextProvider>
      </QueryClientProvider>
    )

    const toBuy = (await screen.findByRole('heading', { name: /To buy/ })).closest('section')!
    const bought = screen.getByRole('heading', { name: 'Bought' }).closest('section')!
    expect(within(toBuy).getByRole('heading', { name: 'Dairy & eggs' })).toBeVisible()
    expect(within(toBuy).getByRole('heading', { name: 'Snacks' })).toBeVisible()
    expect(within(bought).getByRole('heading', { name: 'Bakery' })).toBeVisible()
    expect(screen.queryByRole('heading', { name: 'Pantry' })).not.toBeInTheDocument()
    expect(
      within(toBuy)
        .getAllByRole('button', { name: /^Edit / })
        .map((button) => button.getAttribute('aria-label'))
    ).toEqual(['Edit Milk', 'Edit apple', 'Edit Zebra'])
  })

  it('gives search relevance precedence and restores category sorting when cleared', async () => {
    const user = userEvent.setup()
    await i18n.changeLanguage('en')
    localStorage.setItem('grocery-sort-mode', 'category')
    const products: Product[] = [
      { ...newProduct, id: 'prefix', name: 'Milk chocolate', category: 'snacks' },
      { ...newProduct, id: 'contains', name: 'Buttermilk', category: 'dairy_eggs' },
      { ...newProduct, id: 'fuzzy', name: 'Mlik', category: 'bakery' }
    ]
    vi.spyOn(api.products, 'list').mockResolvedValue(products)
    vi.spyOn(api.realtime, 'subscribe').mockReturnValue({ unsubscribe: vi.fn() } as never)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    render(
      <QueryClientProvider client={client}>
        <I18nextProvider i18n={i18n}>
          <GroceryApp />
        </I18nextProvider>
      </QueryClientProvider>
    )

    const toBuy = (await screen.findByRole('heading', { name: /To buy/ })).closest('section')!
    await user.type(screen.getByRole('textbox', { name: 'Find or add a product' }), 'milk')
    expect(
      within(toBuy)
        .getAllByRole('button', { name: /^Edit / })
        .map((button) => button.getAttribute('aria-label'))
    ).toEqual(['Edit Milk chocolate', 'Edit Buttermilk', 'Edit Mlik'])
    expect(within(toBuy).queryByRole('heading', { name: 'Snacks' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(within(toBuy).getByRole('heading', { name: 'Dairy & eggs' })).toBeVisible()
    expect(
      within(toBuy)
        .getAllByRole('button', { name: /^Edit / })
        .map((button) => button.getAttribute('aria-label'))
    ).toEqual(['Edit Buttermilk', 'Edit Mlik', 'Edit Milk chocolate'])
  })

  it('localizes category sorting for Hebrew RTL', async () => {
    await i18n.changeLanguage('he')
    localStorage.setItem('grocery-sort-mode', 'category')
    vi.spyOn(api.products, 'list').mockResolvedValue([
      { ...newProduct, id: 'hebrew-snack', name: 'חטיף', category: 'snacks' }
    ])
    vi.spyOn(api.realtime, 'subscribe').mockReturnValue({ unsubscribe: vi.fn() } as never)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    render(
      <QueryClientProvider client={client}>
        <I18nextProvider i18n={i18n}>
          <GroceryApp />
        </I18nextProvider>
      </QueryClientProvider>
    )

    expect(await screen.findByRole('button', { name: 'מיון: קטגוריה' })).toBeVisible()
    expect(await screen.findByRole('heading', { name: 'חטיפים' })).toBeVisible()
    expect(document.documentElement).toHaveAttribute('dir', 'rtl')
  })
})

describe('GroceryApp category filtering', () => {
  it('filters both list sections from the category drawer and can show all categories again', async () => {
    const user = userEvent.setup()
    await i18n.changeLanguage('en')
    const products: Product[] = [
      { ...newProduct, id: 'snack-to-buy', name: 'Pretzels', category: 'snacks' },
      { ...newProduct, id: 'dairy-to-buy', name: 'Yogurt', category: 'dairy_eggs' },
      { ...boughtProduct, id: 'snack-bought', name: 'Chips', category: 'snacks' },
      { ...boughtProduct, id: 'bakery-bought', name: 'Rolls', category: 'bakery' }
    ]
    vi.spyOn(api.products, 'list').mockResolvedValue(products)
    vi.spyOn(api.realtime, 'subscribe').mockReturnValue({ unsubscribe: vi.fn() } as never)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    render(
      <QueryClientProvider client={client}>
        <I18nextProvider i18n={i18n}>
          <GroceryApp />
        </I18nextProvider>
      </QueryClientProvider>
    )

    expect(await screen.findByRole('button', { name: 'Edit Pretzels' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Edit Yogurt' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Edit Chips' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Edit Rolls' })).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Filter categories' }))
    expect(screen.queryByText('Applies to both To buy and Bought.')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Apply filters' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Show all' })).not.toBeInTheDocument()

    const allCategories = screen.getByRole('button', { name: 'All categories' })
    let categoryButtons = PRODUCT_CATEGORIES.map((category) =>
      screen.getByRole('button', { name: i18n.t(`category_${category}`) })
    )
    expect(allCategories).toHaveAttribute('aria-pressed', 'false')
    categoryButtons.forEach((button) => expect(button).toHaveAttribute('aria-pressed', 'false'))
    expect(document.querySelector('.filter-button.is-active')).not.toBeInTheDocument()

    await user.click(allCategories)
    expect(allCategories).toHaveAttribute('aria-pressed', 'true')
    categoryButtons.forEach((button) => expect(button).toHaveAttribute('aria-pressed', 'true'))
    expect(document.querySelector('.filter-button.is-active')).not.toBeInTheDocument()

    await user.click(allCategories)
    expect(allCategories).toHaveAttribute('aria-pressed', 'false')
    categoryButtons.forEach((button) => expect(button).toHaveAttribute('aria-pressed', 'false'))
    expect(document.querySelector('.filter-count')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Snacks' }))
    expect(screen.getByRole('button', { name: 'Snacks' })).toHaveAttribute('aria-pressed', 'true')

    const options = document.querySelector<HTMLElement>('.category-filter-options')!
    expect(
      within(options)
        .getAllByRole('button')
        .slice(0, 3)
        .map((button) => button.textContent)
    ).toEqual(['All categories', 'Snacks', 'Fruit & vegetables'])

    await user.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Filter categories' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(screen.getByRole('button', { name: 'Edit Pretzels' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Edit Chips' })).toBeVisible()
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Edit Yogurt' })).not.toBeInTheDocument()
    )
    expect(screen.queryByRole('button', { name: 'Edit Rolls' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Filter categories' }))
    await user.click(screen.getByRole('button', { name: 'All categories' }))
    categoryButtons = PRODUCT_CATEGORIES.map((category) =>
      screen.getByRole('button', { name: i18n.t(`category_${category}`) })
    )
    categoryButtons.forEach((button) => expect(button).toHaveAttribute('aria-pressed', 'true'))

    await user.click(screen.getByRole('button', { name: 'All categories' }))
    categoryButtons.forEach((button) => expect(button).toHaveAttribute('aria-pressed', 'false'))
    await user.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    expect(screen.getByRole('button', { name: 'Filter categories' })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
    expect(screen.getByRole('button', { name: 'Edit Yogurt' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Edit Rolls' })).toBeVisible()
  })
})

describe('GroceryApp realtime categories', () => {
  it('scopes query and realtime state to the authenticated household', async () => {
    const user = userEvent.setup()
    const secondHouseholdId = '20000000-0000-0000-0000-000000000002'
    const secondHouseholdProduct = {
      ...newProduct,
      household_id: secondHouseholdId,
      name: 'Bread'
    }
    vi.spyOn(api.products, 'list').mockImplementation(async () =>
      authState.profile.household_id === secondHouseholdId
        ? [secondHouseholdProduct]
        : [boughtProduct]
    )
    const unsubscribe = vi.fn()
    const subscribe = vi.spyOn(api.realtime, 'subscribe').mockReturnValue({ unsubscribe } as never)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const view = render(
      <QueryClientProvider client={client}>
        <I18nextProvider i18n={i18n}>
          <GroceryApp />
        </I18nextProvider>
      </QueryClientProvider>
    )

    expect(await screen.findByRole('button', { name: 'Edit Milk' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Edit Milk' }))
    expect(screen.getByRole('dialog')).toBeVisible()
    expect(client.getQueryData(['products'])).toBeUndefined()
    expect(client.getQueryData(['products', boughtProduct.household_id])).toEqual([boughtProduct])
    expect(subscribe).toHaveBeenLastCalledWith(
      expect.any(Function),
      expect.any(Function),
      boughtProduct.household_id
    )

    authState.profile = {
      role: 'member',
      household_id: secondHouseholdId,
      product_tour_completed_at: undefined
    }
    view.rerender(
      <QueryClientProvider client={client}>
        <I18nextProvider i18n={i18n}>
          <GroceryApp />
        </I18nextProvider>
      </QueryClientProvider>
    )

    expect(await screen.findByRole('button', { name: 'Edit Bread' })).toBeVisible()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(subscribe).toHaveBeenLastCalledWith(
      expect.any(Function),
      expect.any(Function),
      secondHouseholdId
    )
    expect(client.getQueryData(['products', secondHouseholdId])).toEqual([secondHouseholdProduct])
  })

  it('reconciles an open drawer with an authoritative category refetch', async () => {
    const user = userEvent.setup()
    const refreshedProduct = { ...boughtProduct, category: 'pantry' as const, version: 2 }
    vi.spyOn(api.products, 'list')
      .mockResolvedValueOnce([boughtProduct])
      .mockResolvedValue([refreshedProduct])
    const update = vi
      .spyOn(api.products, 'update')
      .mockRejectedValue(new ApiError('PT409', 'product_conflict'))
    vi.spyOn(api.profile, 'current').mockResolvedValue({
      id: boughtProduct.updated_by!,
      name: 'Lee',
      email: 'admin@example.com',
      role: 'admin',
      product_tour_completed_at: '2026-08-05T12:00:00.000Z',
      created_at: boughtProduct.created_at,
      updated_at: boughtProduct.updated_at
    })
    let onProductChange: () => void = () => undefined
    vi.spyOn(api.realtime, 'subscribe').mockImplementation((onChange) => {
      onProductChange = onChange
      return { unsubscribe: vi.fn() } as never
    })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    render(
      <QueryClientProvider client={client}>
        <I18nextProvider i18n={i18n}>
          <GroceryApp />
        </I18nextProvider>
      </QueryClientProvider>
    )

    await user.click(await screen.findByRole('button', { name: 'Edit Milk' }))
    expect(screen.getByRole('combobox', { name: 'Category' })).toHaveValue('other')

    onProductChange()

    const category = screen.getByRole('combobox', { name: 'Category' })
    await waitFor(() => expect(category).toHaveValue('pantry'))

    await user.selectOptions(category, 'snacks')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Someone changed this product')
    expect(update.mock.calls[0]?.[0].version).toBe(1)
    expect(category).toHaveValue('snacks')
  })
})

describe('GroceryApp product tour', () => {
  it('shows a new member tour after household entry and does not reopen after completion', async () => {
    const user = userEvent.setup()
    authState.profile = {
      role: 'member',
      household_id: boughtProduct.household_id,
      product_tour_completed_at: null
    }
    vi.spyOn(api.products, 'list').mockResolvedValue([boughtProduct])
    vi.spyOn(api.realtime, 'subscribe').mockReturnValue({ unsubscribe: vi.fn() } as never)
    const completedAt = '2026-08-05T12:00:00.000Z'
    const complete = vi.spyOn(api.profile, 'completeProductTour').mockImplementation(async () => {
      authState.profile.product_tour_completed_at = completedAt
      return completedAt
    })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const view = render(
      <QueryClientProvider client={client}>
        <I18nextProvider i18n={i18n}>
          <GroceryApp />
        </I18nextProvider>
      </QueryClientProvider>
    )

    expect(await screen.findByRole('heading', { name: 'Find anything quickly' })).toBeVisible()
    expect(screen.getByText('Step 1 of 4')).toBeVisible()
    expect(
      screen.queryByRole('heading', { name: 'Manage household members' })
    ).not.toBeInTheDocument()
    for (let step = 0; step < 4; step += 1) {
      await user.click(screen.getByRole('button', { name: 'Next' }))
    }
    await waitFor(() => expect(complete).toHaveBeenCalledOnce())
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    view.rerender(
      <QueryClientProvider client={client}>
        <I18nextProvider i18n={i18n}>
          <GroceryApp />
        </I18nextProvider>
      </QueryClientProvider>
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    view.unmount()
    const nextClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={nextClient}>
        <I18nextProvider i18n={i18n}>
          <GroceryApp />
        </I18nextProvider>
      </QueryClientProvider>
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('gives admins the member-management step', async () => {
    const user = userEvent.setup()
    authState.profile = {
      role: 'admin',
      household_id: boughtProduct.household_id,
      product_tour_completed_at: null
    }
    vi.spyOn(api.products, 'list').mockResolvedValue([boughtProduct])
    vi.spyOn(api.realtime, 'subscribe').mockReturnValue({ unsubscribe: vi.fn() } as never)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    render(
      <QueryClientProvider client={client}>
        <I18nextProvider i18n={i18n}>
          <GroceryApp />
        </I18nextProvider>
      </QueryClientProvider>
    )

    for (let step = 0; step < 4; step += 1) {
      await user.click(await screen.findByRole('button', { name: 'Next' }))
    }
    expect(await screen.findByRole('heading', { name: 'Manage household members' })).toBeVisible()
    expect(screen.getByText('Step 5 of 5')).toBeVisible()
  })
})

describe('GroceryApp entitlement banner', () => {
  it('shows paid-specific messaging when a subscription ends', async () => {
    await i18n.changeLanguage('en')
    vi.spyOn(api.products, 'list').mockResolvedValue([boughtProduct])
    vi.spyOn(api.realtime, 'subscribe').mockReturnValue({ unsubscribe: vi.fn() } as never)
    vi.spyOn(api.household, 'entitlement').mockResolvedValue({
      household_id: boughtProduct.household_id,
      access_state: 'read_only_grace',
      trial_starts_at: null,
      trial_ends_at: null,
      grace_ends_at: new Date(Date.now() + 3 * 86_400_000).toISOString(),
      seat_limit: 5,
      enforcement_enabled: true,
      can_mutate: false,
      reads_available: true
    })
    vi.spyOn(api.household, 'subscription').mockResolvedValue({
      household_id: boughtProduct.household_id,
      status: 'unpaid',
      provider: 'stripe',
      provider_subscription_id: 'sub_1',
      current_period_start: new Date(Date.now() - 8 * 86_400_000).toISOString(),
      current_period_end: new Date(Date.now() - 1 * 86_400_000).toISOString(),
      grace_ends_at: new Date(Date.now() + 6 * 86_400_000).toISOString(),
      cancel_at_period_end: true,
      canceled_at: null,
      base_seat_allowance: 5,
      add_on_seat_count: 0,
      add_on_unit_amount_minor_units: null,
      currency: null,
      provider_event_id: null,
      active_member_count: 2,
      billed_seat_count: 0,
      billing_enabled: true
    })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <I18nextProvider i18n={i18n}>
          <GroceryApp />
        </I18nextProvider>
      </QueryClientProvider>
    )

    expect(
      await screen.findByText(
        'Your subscription has ended. The list is available to read during the seven-day grace period.'
      )
    ).toBeVisible()
    expect(screen.queryByText(/^Your trial has ended/)).not.toBeInTheDocument()
  })

  it.each(['canceled', 'paused', 'past_due'] as const)(
    'uses the same attention copy for a future-period paid %s boundary',
    async (status) => {
      await i18n.changeLanguage('en')
      vi.spyOn(api.products, 'list').mockResolvedValue([boughtProduct])
      vi.spyOn(api.realtime, 'subscribe').mockReturnValue({ unsubscribe: vi.fn() } as never)
      vi.spyOn(api.household, 'entitlement').mockResolvedValue({
        household_id: boughtProduct.household_id,
        access_state: 'read_only_grace',
        trial_starts_at: null,
        trial_ends_at: null,
        grace_ends_at: new Date(Date.now() + 37 * 86_400_000).toISOString(),
        seat_limit: 5,
        enforcement_enabled: true,
        can_mutate: false,
        reads_available: true
      })
      vi.spyOn(api.household, 'subscription').mockResolvedValue({
        household_id: boughtProduct.household_id,
        status,
        provider: 'stripe',
        provider_subscription_id: 'sub_1',
        current_period_start: new Date(Date.now() - 86_400_000).toISOString(),
        current_period_end: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        grace_ends_at: new Date(Date.now() + 37 * 86_400_000).toISOString(),
        cancel_at_period_end: false,
        canceled_at: null,
        base_seat_allowance: 5,
        add_on_seat_count: 0,
        add_on_unit_amount_minor_units: null,
        currency: null,
        provider_event_id: null,
        active_member_count: 2,
        billed_seat_count: 0,
        billing_enabled: true
      })
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      render(
        <QueryClientProvider client={client}>
          <I18nextProvider i18n={i18n}>
            <GroceryApp />
          </I18nextProvider>
        </QueryClientProvider>
      )

      expect(
        await screen.findByText(
          'Your subscription requires attention. The list remains available to read, but changes are unavailable.'
        )
      ).toBeVisible()
      expect(screen.queryByText(/^Your subscription has ended/)).not.toBeInTheDocument()
    }
  )

  it('keeps the trial messaging for a trial household in grace and shows no banner for paid active', async () => {
    await i18n.changeLanguage('en')
    vi.spyOn(api.products, 'list').mockResolvedValue([boughtProduct])
    vi.spyOn(api.realtime, 'subscribe').mockReturnValue({ unsubscribe: vi.fn() } as never)
    vi.spyOn(api.household, 'entitlement').mockResolvedValue({
      household_id: boughtProduct.household_id,
      access_state: 'read_only_grace',
      trial_starts_at: '2026-07-01T12:00:00Z',
      trial_ends_at: '2026-07-15T12:00:00Z',
      grace_ends_at: '2026-07-22T12:00:00Z',
      seat_limit: 5,
      enforcement_enabled: true,
      can_mutate: false,
      reads_available: true
    })
    vi.spyOn(api.household, 'subscription').mockResolvedValue({
      household_id: boughtProduct.household_id,
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
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <I18nextProvider i18n={i18n}>
          <GroceryApp />
        </I18nextProvider>
      </QueryClientProvider>
    )

    expect(
      await screen.findByText(
        'Your trial has ended. The list is available to read during the seven-day grace period.'
      )
    ).toBeVisible()
  })

  it('uses paid-specific copy for a mutation rejected on a paid locked boundary', async () => {
    await i18n.changeLanguage('en')
    vi.spyOn(api.products, 'list').mockResolvedValue([boughtProduct])
    vi.spyOn(api.realtime, 'subscribe').mockReturnValue({ unsubscribe: vi.fn() } as never)
    // Simulates the stale-client race: the client still allows mutations while
    // the server has already moved a paid household to the locked boundary.
    vi.spyOn(api.household, 'entitlement').mockResolvedValue({
      household_id: boughtProduct.household_id,
      access_state: 'read_only_grace',
      trial_starts_at: null,
      trial_ends_at: null,
      grace_ends_at: new Date(Date.now() + 3 * 86_400_000).toISOString(),
      seat_limit: 5,
      enforcement_enabled: true,
      can_mutate: true,
      reads_available: true
    })
    vi.spyOn(api.household, 'subscription').mockResolvedValue({
      household_id: boughtProduct.household_id,
      status: 'canceled',
      provider: 'stripe',
      provider_subscription_id: 'sub_1',
      current_period_start: new Date(Date.now() - 8 * 86_400_000).toISOString(),
      current_period_end: new Date(Date.now() - 1 * 86_400_000).toISOString(),
      grace_ends_at: new Date(Date.now() + 6 * 86_400_000).toISOString(),
      cancel_at_period_end: true,
      canceled_at: new Date(Date.now() - 1 * 86_400_000).toISOString(),
      base_seat_allowance: 5,
      add_on_seat_count: 0,
      add_on_unit_amount_minor_units: null,
      currency: null,
      provider_event_id: null,
      active_member_count: 2,
      billed_seat_count: 0,
      billing_enabled: true
    })
    const create = vi
      .spyOn(api.products, 'create')
      .mockRejectedValue(new ApiError('42501', 'household_entitlement_locked'))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <I18nextProvider i18n={i18n}>
          <GroceryApp />
        </I18nextProvider>
      </QueryClientProvider>
    )

    expect(
      await screen.findByText(
        'Your subscription has ended. The list is available to read during the seven-day grace period.'
      )
    ).toBeVisible()
    await userEvent.type(screen.getByPlaceholderText('Find or add a product'), 'Coffee')
    await userEvent.click(screen.getByRole('button', { name: 'Add Coffee' }))

    const paidCopy =
      'Your subscription has ended. The list remains available to read, but changes are unavailable.'
    await waitFor(() => {
      const toast = screen
        .queryAllByRole('status')
        .find(
          (message) => message.classList.contains('app-toast') && message.textContent === paidCopy
        )
      expect(toast).toBeDefined()
      expect(toast).toBeVisible()
      expect(toast).toHaveStyle({ opacity: '1' })
    })
    expect(create).toHaveBeenCalled()
  })

  it('uses paid copy and refreshes subscription after a paid-active stale transition', async () => {
    await i18n.changeLanguage('en')
    vi.spyOn(api.products, 'list').mockResolvedValue([boughtProduct])
    vi.spyOn(api.realtime, 'subscribe').mockReturnValue({ unsubscribe: vi.fn() } as never)
    const paidEntitlement = {
      household_id: boughtProduct.household_id,
      access_state: 'paid_active' as const,
      trial_starts_at: null,
      trial_ends_at: null,
      grace_ends_at: new Date(Date.now() + 3 * 86_400_000).toISOString(),
      seat_limit: 5,
      enforcement_enabled: true,
      can_mutate: true,
      reads_available: true
    }
    const lockedEntitlement = {
      ...paidEntitlement,
      access_state: 'unavailable_locked' as const,
      can_mutate: false
    }
    vi.spyOn(api.household, 'entitlement')
      .mockResolvedValueOnce(paidEntitlement)
      .mockResolvedValue(lockedEntitlement)
    const subscription = vi.spyOn(api.household, 'subscription').mockResolvedValue({
      household_id: boughtProduct.household_id,
      status: 'canceled',
      provider: 'stripe',
      provider_subscription_id: 'sub_1',
      current_period_start: new Date(Date.now() - 8 * 86_400_000).toISOString(),
      current_period_end: new Date(Date.now() - 1 * 86_400_000).toISOString(),
      grace_ends_at: new Date(Date.now() + 6 * 86_400_000).toISOString(),
      cancel_at_period_end: true,
      canceled_at: new Date(Date.now() - 1 * 86_400_000).toISOString(),
      base_seat_allowance: 5,
      add_on_seat_count: 0,
      add_on_unit_amount_minor_units: null,
      currency: null,
      provider_event_id: null,
      active_member_count: 2,
      billed_seat_count: 0,
      billing_enabled: true
    })
    const create = vi
      .spyOn(api.products, 'create')
      .mockRejectedValue(new ApiError('42501', 'household_entitlement_locked'))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <I18nextProvider i18n={i18n}>
          <GroceryApp />
        </I18nextProvider>
      </QueryClientProvider>
    )

    await waitFor(() => expect(subscription).not.toHaveBeenCalled())
    await userEvent.type(screen.getByPlaceholderText('Find or add a product'), 'Coffee')
    await userEvent.click(screen.getByRole('button', { name: 'Add Coffee' }))

    const paidCopy =
      'Your subscription has ended. The list remains available to read, but changes are unavailable.'
    await waitFor(() => {
      const toast = screen
        .queryAllByRole('status')
        .find(
          (message) => message.classList.contains('app-toast') && message.textContent === paidCopy
        )
      expect(toast).toBeDefined()
      expect(toast).toBeVisible()
      expect(toast).toHaveStyle({ opacity: '1' })
    })
    expect(subscription).toHaveBeenCalled()
    expect(create).toHaveBeenCalled()
  })

  it('keeps trial-specific copy for a mutation rejected on a trial locked boundary', async () => {
    await i18n.changeLanguage('en')
    vi.spyOn(api.products, 'list').mockResolvedValue([boughtProduct])
    vi.spyOn(api.realtime, 'subscribe').mockReturnValue({ unsubscribe: vi.fn() } as never)
    vi.spyOn(api.household, 'entitlement').mockResolvedValue({
      household_id: boughtProduct.household_id,
      access_state: 'unavailable_locked',
      trial_starts_at: '2026-07-01T12:00:00Z',
      trial_ends_at: '2026-07-15T12:00:00Z',
      grace_ends_at: '2026-07-22T12:00:00Z',
      seat_limit: 5,
      enforcement_enabled: true,
      can_mutate: true,
      reads_available: true
    })
    vi.spyOn(api.household, 'subscription').mockResolvedValue({
      household_id: boughtProduct.household_id,
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
    const create = vi
      .spyOn(api.products, 'create')
      .mockRejectedValue(new ApiError('42501', 'household_entitlement_locked'))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <I18nextProvider i18n={i18n}>
          <GroceryApp />
        </I18nextProvider>
      </QueryClientProvider>
    )

    expect(
      await screen.findByText(
        'Your trial has ended. The list remains available to read, but changes are unavailable.'
      )
    ).toBeVisible()
    await userEvent.type(screen.getByPlaceholderText('Find or add a product'), 'Coffee')
    await userEvent.click(screen.getByRole('button', { name: 'Add Coffee' }))

    expect(create).toHaveBeenCalled()
    expect(screen.queryByText(/^Your subscription has ended/)).not.toBeInTheDocument()
  })
})

describe('ProductSection', () => {
  it('shows the bought heading with a restore-all action and no counter', () => {
    render(buildProductSection([boughtProduct]))

    const heading = screen.getByRole('heading', { name: 'Bought' })
    expect(heading).toBeVisible()
    expect(heading.querySelector('.section-count')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Restore all' })).toBeVisible()
  })

  it('does not give a filtered product another entrance animation', () => {
    const view = render(buildProductSection([]))
    view.rerender(buildProductSection([boughtProduct]))

    expect(view.container.querySelector(`[data-product-id="${boughtProduct.id}"]`)).not.toHaveStyle(
      { transform: 'scale(0.9)' }
    )
  })

  it('gives a genuinely new product an entrance animation', () => {
    const view = render(buildProductSection([boughtProduct]))
    view.rerender(buildProductSection([boughtProduct, newProduct], new Set([newProduct.id])))

    expect(view.container.querySelector(`[data-product-id="${newProduct.id}"]`)).toHaveStyle({
      opacity: '0',
      transform: 'scale(0.9)'
    })
  })
})
