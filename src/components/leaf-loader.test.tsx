import { render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, it } from 'vitest'
import i18n from '../i18n'
import { LeafLoader } from './leaf-loader'

describe('LeafLoader', () => {
  it('has a localized status label', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <LeafLoader />
      </I18nextProvider>
    )
    expect(screen.getByRole('status')).toHaveAccessibleName(i18n.t('loading'))
  })
})
