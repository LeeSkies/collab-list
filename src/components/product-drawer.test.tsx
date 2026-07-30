import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { api } from '../lib/api'
import type { Product } from '../lib/types'
import { ProductDrawer } from './product-drawer'

const product: Product = {
  id: '10000000-0000-0000-0000-000000000003',
  name: 'Milk',
  name_signature: '4:milk',
  quantity: '2.00',
  notes: 'Buy the blue carton',
  category: 'dairy_eggs',
  is_picked: false,
  picked_at: null,
  ordering_at: '2026-07-13T12:00:00.000Z',
  version: 1,
  created_by: '10000000-0000-0000-0000-000000000001',
  updated_by: '10000000-0000-0000-0000-000000000001',
  created_at: '2026-07-13T12:00:00.000Z',
  updated_at: '2026-07-13T12:00:00.000Z'
}

function renderDrawer(onSave = vi.fn().mockResolvedValue(undefined)) {
  vi.spyOn(api.profile, 'current').mockResolvedValue({
    id: '10000000-0000-0000-0000-000000000001',
    name: 'Lee',
    email: 'admin@example.com',
    role: 'admin',
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
          open
          onOpenChange={vi.fn()}
          onSave={onSave}
          onDelete={vi.fn().mockResolvedValue(undefined)}
          onToggle={vi.fn()}
          pending={false}
        />
      </I18nextProvider>
    </QueryClientProvider>
  )
}

describe('ProductDrawer', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('offers the fixed category taxonomy through an accessible select', () => {
    renderDrawer()

    const category = screen.getByRole('combobox', { name: 'Category' })
    expect(category).toHaveValue('dairy_eggs')
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

  it('saves a changed category as its stable key', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(undefined)
    renderDrawer(onSave)

    await user.selectOptions(screen.getByRole('combobox', { name: 'Category' }), 'pantry')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(onSave).toHaveBeenCalledWith(product, {
      name: 'Milk',
      quantity: '2.00',
      notes: 'Buy the blue carton',
      category: 'pantry'
    })
  })

  it('translates category labels into Hebrew without changing their values', async () => {
    await i18n.changeLanguage('he')
    renderDrawer()

    const category = screen.getByRole('combobox', { name: 'קטגוריה' })
    expect(category).toHaveValue('dairy_eggs')
    expect(screen.getByRole('option', { name: 'מוצרי חלב וביצים' })).toHaveValue('dairy_eggs')
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
      category: 'dairy_eggs'
    })
  })
})
