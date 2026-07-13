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
  picked_by: null,
  ordering_at: '2026-07-13T12:00:00.000Z',
  version: 1,
  created_at: '2026-07-13T12:00:00.000Z',
  updated_at: '2026-07-13T12:00:00.000Z'
}

describe('ProductSection', () => {
  it('shows the bought heading with a restore-all action and no counter', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <ProductSection
          title="Bought"
          products={[boughtProduct]}
          showCount={false}
          headerAction={<button aria-label="Restore all" />}
          duplicatePulse=""
          onEdit={vi.fn()}
          onAdjust={vi.fn()}
          onToggle={vi.fn()}
        />
      </I18nextProvider>
    )

    const heading = screen.getByRole('heading', { name: 'Bought' })
    expect(heading).toBeVisible()
    expect(heading.querySelector('.section-count')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Restore all' })).toBeVisible()
  })
})
