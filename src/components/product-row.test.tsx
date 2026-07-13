import { render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import type { Product } from '../lib/types'
import { ProductRow } from './product-row'

const product: Product = {
  id: '10000000-0000-0000-0000-000000000003',
  name: 'Milk',
  name_signature: '4:milk',
  quantity: '2.00',
  notes: null,
  is_picked: false,
  picked_at: null,
  picked_by: null,
  ordering_at: '2026-07-13T12:00:00.000Z',
  version: 1,
  created_at: '2026-07-13T12:00:00.000Z',
  updated_at: '2026-07-13T12:00:00.000Z'
}

function renderRow(overrides: Partial<Product> = {}) {
  const view = render(
    <I18nextProvider i18n={i18n}>
      <ProductRow
        product={{ ...product, ...overrides }}
        duplicatePulse={false}
        onEdit={vi.fn()}
        onAdjust={vi.fn()}
        onToggle={vi.fn()}
      />
    </I18nextProvider>
  )
  return view
}

describe('ProductRow', () => {
  it('shows quantity controls for an unpicked product', () => {
    renderRow()
    expect(screen.getByRole('button', { name: i18n.t('minus') })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: i18n.t('plus') })).toBeInTheDocument()
  })

  it('shows a read-only quantity input without controls for a picked product', () => {
    renderRow({ is_picked: true, picked_at: '2026-07-13T12:30:00.000Z' })
    const quantity = screen.getByRole('textbox', {
      name: `${i18n.t('quantity')}: ${product.quantity}`
    })
    expect(quantity).toHaveAttribute('readonly')
    expect(screen.queryByRole('button', { name: i18n.t('minus') })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: i18n.t('plus') })).not.toBeInTheDocument()
  })

  it('reveals only an action icon underneath the row', () => {
    const { container } = renderRow()
    expect(container.querySelector('.swipe-reveal')).toHaveTextContent('')
  })
})
