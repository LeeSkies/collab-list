import { render } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import type { Product } from '../lib/types'

const product: Product = {
  id: '10000000-0000-0000-0000-000000000003',
  name: 'Milk',
  name_signature: '4:milk',
  quantity: '2.00',
  notes: null,
  category: 'other',
  is_picked: false,
  picked_at: null,
  ordering_at: '2026-07-13T12:00:00.000Z',
  version: 1,
  created_by: '10000000-0000-0000-0000-000000000001',
  updated_by: '10000000-0000-0000-0000-000000000001',
  created_at: '2026-07-13T12:00:00.000Z',
  updated_at: '2026-07-13T12:00:00.000Z'
}

afterEach(() => vi.unstubAllGlobals())

describe('ProductRow reduced motion', () => {
  it('uses opacity without spatial scaling for a new product', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: true,
        media: '(prefers-reduced-motion)',
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn()
      }))
    )
    const { ProductRow } = await import('./product-row')

    const view = render(
      <I18nextProvider i18n={i18n}>
        <ProductRow
          product={product}
          duplicatePulse={false}
          animateEntrance
          onEdit={vi.fn()}
          onAdjust={vi.fn()}
          onToggle={vi.fn()}
        />
      </I18nextProvider>
    )

    const row = view.container.querySelector(`[data-product-id="${product.id}"]`)
    expect(row).toHaveStyle({ opacity: '0' })
    expect(row).not.toHaveStyle({ transform: 'scale(0.9)' })
  })
})
