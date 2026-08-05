import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { api, ApiError } from '../lib/api'
import type { Category, Product } from '../lib/types'
import { ProductDrawer } from './product-drawer'

const categories: Category[] = [
  {
    id: 'cat-fruit_vegetables',
    household_id: '20000000-0000-0000-0000-000000000001',
    name: 'fruit_vegetables'
  },
  {
    id: 'cat-dairy_eggs',
    household_id: '20000000-0000-0000-0000-000000000001',
    name: 'dairy_eggs'
  },
  { id: 'cat-meat_fish', household_id: '20000000-0000-0000-0000-000000000001', name: 'meat_fish' },
  { id: 'cat-bakery', household_id: '20000000-0000-0000-0000-000000000001', name: 'bakery' },
  { id: 'cat-pantry', household_id: '20000000-0000-0000-0000-000000000001', name: 'pantry' },
  { id: 'cat-frozen', household_id: '20000000-0000-0000-0000-000000000001', name: 'frozen' },
  { id: 'cat-drinks', household_id: '20000000-0000-0000-0000-000000000001', name: 'drinks' },
  { id: 'cat-snacks', household_id: '20000000-0000-0000-0000-000000000001', name: 'snacks' },
  { id: 'cat-household', household_id: '20000000-0000-0000-0000-000000000001', name: 'household' },
  { id: 'cat-other', household_id: '20000000-0000-0000-0000-000000000001', name: 'other' }
]

const product: Product = {
  household_id: '20000000-0000-0000-0000-000000000001',
  id: '10000000-0000-0000-0000-000000000003',
  name: 'Milk',
  name_signature: '4:milk',
  quantity: '2.00',
  notes: 'Buy the blue carton',
  category_id: 'cat-dairy_eggs',
  is_picked: false,
  picked_at: null,
  ordering_at: '2026-07-13T12:00:00.000Z',
  version: 1,
  created_by: '10000000-0000-0000-0000-000000000001',
  updated_by: '10000000-0000-0000-0000-000000000001',
  created_at: '2026-07-13T12:00:00.000Z',
  updated_at: '2026-07-13T12:00:00.000Z'
}

function renderDrawer(
  onSave = vi.fn().mockResolvedValue(undefined),
  props: Partial<Parameters<typeof ProductDrawer>[0]> = {}
) {
  vi.spyOn(api.profile, 'current').mockResolvedValue({
    id: '10000000-0000-0000-0000-000000000001',
    name: 'Lee',
    email: 'admin@example.com',
    role: 'admin',
    product_tour_completed_at: '2026-08-05T12:00:00.000Z',
    created_at: '2026-07-13T11:00:00.000Z',
    updated_at: '2026-07-13T11:00:00.000Z'
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <ProductDrawer
          product={product}
          products={[product]}
          categories={categories}
          open
          onOpenChange={vi.fn()}
          onSave={onSave}
          onDelete={vi.fn().mockResolvedValue(undefined)}
          onToggle={vi.fn()}
          pending={false}
          {...props}
        />
      </I18nextProvider>
    </QueryClientProvider>
  )
}

describe('ProductDrawer', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('offers the household categories through an accessible select', () => {
    renderDrawer()

    const category = screen.getByRole('combobox', { name: 'Category' })
    expect(category).toHaveValue('cat-dairy_eggs')
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Fruit & vegetables',
      'Dairy & eggs',
      'Meat & fish',
      'Bakery',
      'Pantry',
      'Frozen',
      'Drinks',
      'Snacks',
      'Household',
      'Other'
    ])
  })

  it('saves a changed category as its household category reference', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(undefined)
    renderDrawer(onSave)

    await user.selectOptions(screen.getByRole('combobox', { name: 'Category' }), 'cat-pantry')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(onSave).toHaveBeenCalledWith(product, {
      name: 'Milk',
      quantity: '2.00',
      notes: 'Buy the blue carton',
      category_id: 'cat-pantry'
    })
  })

  it('translates category labels into Hebrew without changing their values', async () => {
    await i18n.changeLanguage('he')
    renderDrawer()

    const category = screen.getByRole('combobox', { name: 'קטגוריה' })
    expect(category).toHaveValue('cat-dairy_eggs')
    expect(screen.getByRole('option', { name: 'מוצרי חלב וביצים' })).toHaveValue('cat-dairy_eggs')
  })

  it('falls back to the stored name for custom categories', () => {
    renderDrawer(vi.fn().mockResolvedValue(undefined), {
      categories: [
        ...categories,
        { id: 'cat-cheese', household_id: '20000000-0000-0000-0000-000000000001', name: 'Cheese' }
      ]
    })

    expect(screen.getByRole('option', { name: 'Cheese' })).toHaveValue('cat-cheese')
  })

  it('clears notes and enables saving the change', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(undefined)
    renderDrawer(onSave)

    expect(screen.getByRole('heading', { name: 'Milk' })).toBeVisible()
    expect(screen.queryByText('Created')).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Updated' })).toBeVisible()
    expect(await screen.findByText('Lee')).toBeVisible()
    expect(screen.queryByRole('button', { name: /history/i })).not.toBeInTheDocument()
    const notes = screen.getByRole('textbox', { name: /Notes/ })
    expect(notes).toHaveValue('Buy the blue carton')
    await user.click(screen.getByRole('button', { name: 'Clear notes' }))
    expect(notes).toHaveValue('')

    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(onSave).toHaveBeenCalledWith(product, {
      name: 'Milk',
      quantity: '2.00',
      notes: '',
      category_id: 'cat-dairy_eggs'
    })
  })

  it('shows paid-specific copy when saving is rejected on a paid read-only boundary', async () => {
    const user = userEvent.setup()
    renderDrawer(vi.fn().mockRejectedValue(new ApiError('42501', 'household_read_only')), {
      boundaryIsPaid: true
    })

    await user.clear(screen.getByRole('textbox', { name: /Notes/ }))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your subscription has ended. The list is available to read during the seven-day grace period.'
    )
  })

  it('uses attention copy when saving is rejected on a future-period paid boundary', async () => {
    const user = userEvent.setup()
    renderDrawer(vi.fn().mockRejectedValue(new ApiError('42501', 'household_read_only')), {
      boundaryIsPaid: true,
      paidBoundaryNeedsAttention: true
    })

    await user.clear(screen.getByRole('textbox', { name: /Notes/ }))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your subscription requires attention. The list remains available to read, but changes are unavailable.'
    )
  })

  it('keeps trial-specific copy when saving is rejected on a trial read-only boundary', async () => {
    const user = userEvent.setup()
    renderDrawer(vi.fn().mockRejectedValue(new ApiError('42501', 'household_read_only')))

    await user.clear(screen.getByRole('textbox', { name: /Notes/ }))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your trial has ended. The list is available to read during the seven-day grace period.'
    )
  })
})
