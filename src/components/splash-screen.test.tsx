import { render, screen, within } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, it } from 'vitest'
import i18n from '../i18n'
import { SplashScreen } from './splash-screen'

describe('SplashScreen', () => {
  it('has a localized status label and a decorative mark', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <SplashScreen />
      </I18nextProvider>
    )
    const status = screen.getByRole('status')
    expect(status).toHaveAccessibleName(i18n.t('loading'))
    const mark = within(status).getByTestId('splash-mark')
    expect(mark).toHaveAttribute('aria-hidden', 'true')
  })
})
