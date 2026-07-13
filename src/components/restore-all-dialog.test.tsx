import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { RestoreAllDialog } from './restore-all-dialog'

afterEach(async () => {
  await i18n.changeLanguage('en')
})

function renderDialog(onConfirm = vi.fn()) {
  const props = {
    open: true,
    onOpenChange: vi.fn(),
    onConfirm,
    pending: false
  }
  const view = render(
    <I18nextProvider i18n={i18n}>
      <RestoreAllDialog {...props} />
    </I18nextProvider>
  )
  return { ...view, props }
}

describe('RestoreAllDialog', () => {
  it('submits both reset options', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    renderDialog(onConfirm)

    await user.click(screen.getByRole('switch', { name: 'Clear notes' }))
    await user.click(screen.getByRole('switch', { name: 'Reset quantities to 1' }))
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(onConfirm).toHaveBeenCalledWith({ clearNotes: true, resetQuantities: true })
  })

  it('keeps both options off by default', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    renderDialog(onConfirm)

    expect(screen.getByRole('switch', { name: 'Clear notes' })).not.toBeChecked()
    expect(screen.getByRole('switch', { name: 'Reset quantities to 1' })).not.toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(onConfirm).toHaveBeenCalledWith({ clearNotes: false, resetQuantities: false })
  })

  it('uses bought terminology in Hebrew', async () => {
    await i18n.changeLanguage('he')
    renderDialog()

    expect(screen.getByRole('heading', { name: 'להחזיר את כל המוצרים שנקנו?' })).toBeVisible()
    expect(screen.getByText('בחרו מהאפשרויות')).toBeVisible()
    expect(screen.getByRole('button', { name: 'אישור' })).toBeVisible()
  })
})
