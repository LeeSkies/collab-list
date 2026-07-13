import { render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it } from 'vitest'
import i18n from '../i18n'
import { AppDrawer, ConfirmDialog } from './drawer'

afterEach(async () => {
  await i18n.changeLanguage('en')
})

describe('ConfirmDialog', () => {
  it('localizes the cancel action', async () => {
    await i18n.changeLanguage('he')
    render(
      <I18nextProvider i18n={i18n}>
        <ConfirmDialog
          open
          onOpenChange={() => undefined}
          title="מחיקה"
          body="אישור מחיקה"
          confirmLabel="מחיקה"
          onConfirm={() => undefined}
          destructive
        />
      </I18nextProvider>
    )

    expect(screen.getByRole('button', { name: 'ביטול' })).toBeVisible()
  })
})

describe('AppDrawer', () => {
  it('separates the fixed header, scrollable content, and footer', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <AppDrawer
          open
          onOpenChange={() => undefined}
          title="Product"
          footer={<button>Save</button>}
        >
          <p>Drawer content</p>
        </AppDrawer>
      </I18nextProvider>
    )

    expect(screen.getByRole('heading', { name: 'Product' })).toBeVisible()
    expect(screen.getByText('Drawer content').closest('.drawer-content')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Save' }).closest('.drawer-footer')
    ).toBeInTheDocument()
  })
})
