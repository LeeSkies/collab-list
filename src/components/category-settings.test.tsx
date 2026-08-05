import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { api, CategoryError } from '../lib/api'
import type { Category } from '../lib/types'
import { CategoriesSettings } from './category-settings'

const authState = vi.hoisted(() => ({
  profile: {
    household_id: 'household-a',
    role: 'member' as 'admin' | 'member',
    email: 'old@example.com'
  }
}))

vi.mock('../auth', () => ({
  useAuth: () => authState
}))

const categories: Category[] = [
  { id: 'cat-other', household_id: 'household-a', name: 'other' },
  { id: 'cat-bakery', household_id: 'household-a', name: 'bakery' },
  { id: 'cat-snacks', household_id: 'household-a', name: 'snacks' }
]

afterEach(() => {
  authState.profile.role = 'member'
  vi.restoreAllMocks()
})

beforeEach(() => {
  vi.spyOn(api.categories, 'list').mockResolvedValue(categories)
})

function renderSettings(
  canMutate = true,
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  })
) {
  render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <CategoriesSettings canMutate={canMutate} />
      </I18nextProvider>
    </QueryClientProvider>
  )
  return client
}

describe('CategoriesSettings creation', () => {
  it('adds a trimmed category through the RPC and invalidates category and product queries', async () => {
    const user = userEvent.setup()
    const client = renderSettings()
    const create = vi.spyOn(api.categories, 'create').mockResolvedValue({
      id: 'cat-new',
      household_id: 'household-a',
      name: 'baking'
    })
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    await user.type(screen.getByRole('textbox', { name: 'Find or add a category' }), '  baking  ')
    await user.click(screen.getByRole('button', { name: 'Add category' }))

    await waitFor(() => expect(create.mock.calls[0]?.[0]).toBe('  baking  '))
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Category baking added.')
    )
    expect(screen.getByRole('textbox', { name: 'Find or add a category' })).toHaveValue('')
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['categories', 'household-a'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['products', 'household-a'] })
  })

  it('shows a friendly message for a duplicate name', async () => {
    const user = userEvent.setup()
    renderSettings()
    vi.spyOn(api.categories, 'create').mockRejectedValue(
      new CategoryError('duplicate', 'A category with this name already exists')
    )

    await user.type(screen.getByRole('textbox', { name: 'Find or add a category' }), 'bakery')
    await user.click(screen.getByRole('button', { name: 'Add category' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('That category already exists.')
  })

  it('shows a friendly message for an invalid name length', async () => {
    const user = userEvent.setup()
    renderSettings()
    vi.spyOn(api.categories, 'create').mockRejectedValue(
      new CategoryError('invalid_name', 'Enter a category name between 1 and 80 characters')
    )

    await user.type(screen.getByRole('textbox', { name: 'Find or add a category' }), 'x')
    await user.click(screen.getByRole('button', { name: 'Add category' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Enter a category name between 1 and 80 characters.'
    )
  })
})

describe('CategoriesSettings add control', () => {
  it('renders a search-shell style control with a leading icon and an icon-only add button', () => {
    renderSettings()
    const form = document.querySelector('.category-add-form')
    expect(form).not.toBeNull()
    expect(form?.querySelector('svg')).toBeTruthy()
    const add = screen.getByRole('button', { name: 'Add category' })
    expect(add).toHaveAttribute('type', 'submit')
    expect(add).toBeDisabled()
    expect(screen.getByRole('textbox', { name: 'Find or add a category' })).toHaveAttribute(
      'maxlength',
      '80'
    )
  })

  it('gates the add button on mutation permission and a non-empty name', async () => {
    const user = userEvent.setup()
    renderSettings(true)
    const input = screen.getByRole('textbox', { name: 'Find or add a category' })
    const add = screen.getByRole('button', { name: 'Add category' })
    expect(add).toBeDisabled()

    await user.type(input, 'spices')
    expect(add).toBeEnabled()
  })

  it('keeps the add control disabled without mutation permission', () => {
    renderSettings(false)
    expect(screen.getByRole('textbox', { name: 'Find or add a category' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Add category' })).toBeDisabled()
  })

  it('submits the new category name with the Enter key like the main product input', async () => {
    const user = userEvent.setup()
    const client = renderSettings()
    const create = vi.spyOn(api.categories, 'create').mockResolvedValue({
      id: 'cat-new',
      household_id: 'household-a',
      name: 'spices'
    })
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    await user.type(
      screen.getByRole('textbox', { name: 'Find or add a category' }),
      'spices{Enter}'
    )

    await waitFor(() => expect(create.mock.calls[0]?.[0]).toBe('spices'))
    expect(await screen.findByRole('status')).toHaveTextContent('Category spices added.')
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['categories', 'household-a'] })
  })
})

describe('CategoriesSettings deletion permissions', () => {
  it('never shows delete actions to a regular member', async () => {
    authState.profile.role = 'member'
    renderSettings()

    expect(await screen.findByText('Bakery')).toBeVisible()
    expect(screen.queryByRole('button', { name: /Delete category/ })).not.toBeInTheDocument()
  })

  it('shows delete actions to an admin except for the other category', async () => {
    authState.profile.role = 'admin'
    renderSettings()

    expect(await screen.findByRole('button', { name: 'Delete Bakery' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Delete Snacks' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Delete Other' })).not.toBeInTheDocument()
  })

  it('requires a destructive warning before deleting and invalidates after', async () => {
    const user = userEvent.setup()
    authState.profile.role = 'admin'
    const client = renderSettings()
    const remove = vi.spyOn(api.categories, 'remove').mockResolvedValue(undefined)
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    await user.click(await screen.findByRole('button', { name: 'Delete Bakery' }))
    expect(screen.getByRole('heading', { name: 'Delete Bakery?' })).toBeVisible()
    expect(screen.getByText(/Products in this category move to Other/)).toBeVisible()
    expect(remove).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Delete category' }))
    await waitFor(() => expect(remove.mock.calls[0]?.[0]).toBe('cat-bakery'))
    expect(screen.getByRole('status')).toHaveTextContent('Category deleted.')
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['categories', 'household-a'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['products', 'household-a'] })
  })

  it('explains a deletion failure on the server', async () => {
    const user = userEvent.setup()
    authState.profile.role = 'admin'
    renderSettings()
    vi.spyOn(api.categories, 'remove').mockRejectedValue(
      new CategoryError('category_not_found', 'That category no longer exists')
    )

    await user.click(await screen.findByRole('button', { name: 'Delete Snacks' }))
    await user.click(screen.getByRole('button', { name: 'Delete category' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That category was deleted on another device.'
    )
  })
})
