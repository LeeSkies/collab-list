import { render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import type { Product } from '../lib/types'
import { ProductSection } from './product-section'

const boughtProduct: Product = {
  id: '10000000-0000-0000-0000-000000000003',
  name: 'Milk',
  name_signature: '4:milk',
  quantity: '1.00',
  notes: null,
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
