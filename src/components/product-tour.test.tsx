import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { ProductTour } from './product-tour'

function renderTour(role: 'admin' | 'member', onComplete = vi.fn().mockResolvedValue(undefined)) {
  return {
    onComplete,
    ...render(
      <I18nextProvider i18n={i18n}>
        <ProductTour role={role} onComplete={onComplete} />
      </I18nextProvider>
    )
  }
}

afterEach(async () => {
  await i18n.changeLanguage('en')
})

describe('ProductTour', () => {
  it('gives members the product tips without member management', async () => {
    const user = userEvent.setup()
    const { onComplete } = renderTour('member')

    expect(screen.getByRole('dialog')).toBeVisible()
    expect(screen.getByText('Step 1 of 4')).toBeVisible()
    expect(screen.queryByRole('button', { name: /skip/i })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'Manage household members' })
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText('Step 2 of 4')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText('Step 3 of 4')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText('Step 4 of 4')).toBeVisible()
    expect(onComplete).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(onComplete).toHaveBeenCalledOnce()
  })

  it('adds the member-management tip for admins and stays open when saving fails', async () => {
    const user = userEvent.setup()
    const onComplete = vi.fn().mockRejectedValue(new Error('offline'))
    renderTour('admin', onComplete)

    for (let step = 1; step < 5; step += 1) {
      await user.click(screen.getByRole('button', { name: 'Next' }))
    }
    expect(screen.getByRole('heading', { name: 'Manage household members' })).toBeVisible()
    expect(screen.getByText('Step 5 of 5')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Next' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'We could not save your progress. Please try again.'
    )
    expect(screen.getByRole('dialog')).toBeVisible()
  })
})
