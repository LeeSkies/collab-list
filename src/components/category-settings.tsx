import { MagnifyingGlass, Plus, Trash } from '@phosphor-icons/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth'
import { api, CategoryError } from '../lib/api'
import { categoryLabel } from '../lib/product-category'
import type { Category } from '../lib/types'
import { ConfirmDialog } from './drawer'

function categoryErrorMessage(reason: unknown, t: (key: string) => string) {
  if (reason instanceof CategoryError) {
    switch (reason.code) {
      case 'duplicate':
        return t('categoryDuplicate')
      case 'invalid_name':
        return t('invalidCategoryName')
      case 'category_not_found':
        return t('categoryNotFound')
      case 'cannot_delete_other':
        return t('cannotDeleteOther')
      case 'admin_required':
        return t('adminRequired')
      case 'default_category_missing':
        return t('categoryDeleteFailed')
      case 'household_read_only':
        return t('householdReadOnly')
      case 'household_entitlement_locked':
        return t('householdLocked')
      default:
        return t('requestFailed')
    }
  }
  return t('requestFailed')
}

export function CategoriesSettings({ canMutate }: { canMutate: boolean }) {
  const { t } = useTranslation()
  const auth = useAuth()
  const client = useQueryClient()
  const householdId = auth.profile?.household_id
  const isAdmin = auth.profile?.role === 'admin'
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [pendingDelete, setPendingDelete] = useState<Category | null>(null)
  const categoriesQueryKey = ['categories', householdId] as const
  const productsQueryKey = ['products', householdId] as const

  const categories = useQuery({
    queryKey: categoriesQueryKey,
    queryFn: ({ signal }) => api.categories.list(signal),
    enabled: Boolean(householdId),
    retry: 1,
    staleTime: 30_000
  })

  function invalidateAfterMutation() {
    void client.invalidateQueries({ queryKey: categoriesQueryKey })
    void client.invalidateQueries({ queryKey: productsQueryKey })
  }

  const createCategory = useMutation({
    mutationFn: api.categories.create,
    onSuccess: (created) => {
      setName('')
      setError('')
      setNotice(t('categoryAdded', { name: categoryLabel(t, created.name) }))
      invalidateAfterMutation()
    },
    onError: (reason) => {
      setNotice('')
      setError(categoryErrorMessage(reason, t))
    }
  })

  const deleteCategory = useMutation({
    mutationFn: api.categories.remove,
    onSuccess: () => {
      setPendingDelete(null)
      setError('')
      setNotice(t('categoryDeleted'))
      invalidateAfterMutation()
    },
    onError: (reason) => {
      setPendingDelete(null)
      setNotice('')
      setError(categoryErrorMessage(reason, t))
    }
  })

  return (
    <div className="category-settings">
      <form
        className="category-add-form"
        onSubmit={(event) => {
          event.preventDefault()
          if (!canMutate || !name.trim() || createCategory.isPending) return
          setError('')
          setNotice('')
          createCategory.mutate(name)
        }}
      >
        <MagnifyingGlass />
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t('categoryNamePlaceholder')}
          aria-label={t('categoryNamePlaceholder')}
          maxLength={80}
          disabled={!canMutate}
        />
        <button
          type="submit"
          className="category-add-button"
          aria-label={createCategory.isPending ? t('addingCategory') : t('addCategory')}
          disabled={!canMutate || !name.trim() || createCategory.isPending}
        >
          <Plus weight="bold" />
        </button>
      </form>
      {notice && (
        <p className="form-success" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <ul className="category-list">
        {categories.data?.map((category) => (
          <li key={category.id} className="category-row">
            <span>{categoryLabel(t, category.name)}</span>
            {isAdmin && category.name !== 'other' && (
              <button
                type="button"
                className="icon-button danger-quiet"
                aria-label={t('deleteCategoryAction', { name: categoryLabel(t, category.name) })}
                disabled={deleteCategory.isPending}
                onClick={() => setPendingDelete(category)}
              >
                <Trash />
              </button>
            )}
          </li>
        ))}
      </ul>
      {pendingDelete && (
        <ConfirmDialog
          open
          onOpenChange={(next) => !next && setPendingDelete(null)}
          title={t('deleteCategoryTitle', { name: categoryLabel(t, pendingDelete.name) })}
          body={t('deleteCategoryBody')}
          confirmLabel={t('deleteCategory')}
          destructive
          pending={deleteCategory.isPending}
          onConfirm={() => deleteCategory.mutate(pendingDelete.id)}
        />
      )}
    </div>
  )
}
