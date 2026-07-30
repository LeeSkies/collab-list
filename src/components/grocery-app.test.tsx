import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
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

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
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
