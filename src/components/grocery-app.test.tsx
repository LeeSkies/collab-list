import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { api, ApiError } from '../lib/api'
import type { Product } from '../lib/types'
import { GroceryApp } from './grocery-app'
import { ProductSection } from './product-section'

vi.mock('../auth', () => ({
  useAuth: () => ({
    profile: { role: 'member' },
    signOut: vi.fn()
  })
}))

const boughtProduct: Product = {
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
  localStorage.removeItem('grocery-sort-mode')
  await i18n.changeLanguage('en')
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('GroceryApp sorting', () => {
  it('cycles through visible sort modes and restores the persisted mode', async () => {
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
    expect(sort).toHaveTextContent('Default')

    await user.click(sort)
    expect(screen.getByRole('button', { name: 'Sort: Name' })).toHaveTextContent('Name')
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
    await user.click(restored)
    expect(screen.getByRole('button', { name: 'Sort: Category' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Sort: Category' }))
    expect(screen.getByRole('button', { name: 'Sort: Default' })).toBeVisible()
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

describe('GroceryApp realtime categories', () => {
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
