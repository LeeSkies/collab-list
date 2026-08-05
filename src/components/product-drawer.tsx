import { Eraser, Trash } from '@phosphor-icons/react'
import { useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { api, isApiErrorCode, isProductConflict } from '../lib/api'
import { categoryLabel } from '../lib/product-category'
import {
  duplicateSignature,
  normalizeNameForStorage,
  PRODUCT_NAME_MAX,
  PRODUCT_NOTES_MAX,
  validateQuantity
} from '../lib/product'
import type { Category, Product, ProductChanges } from '../lib/types'
import { AppDrawer, ConfirmDialog } from './drawer'
import { HoldToRevealName } from './hold-to-reveal-name'
import { Button } from './ui/button'

export function ProductDrawer({
  product,
  authoritativeProduct = product,
  products,
  open,
  onOpenChange,
  onSave,
  onDelete,
  onToggle,
  pending,
  categories,
  canMutate = true,
  boundaryIsPaid = false,
  paidBoundaryNeedsAttention = false
}: {
  product: Product
  authoritativeProduct?: Product
  products: Product[]
  open: boolean
  onOpenChange(open: boolean): void
  onSave(product: Product, changes: ProductChanges): Promise<void>
  onDelete(product: Product): Promise<void>
  onToggle(product: Product): void
  pending: boolean
  categories: Category[]
  canMutate?: boolean
  boundaryIsPaid?: boolean
  paidBoundaryNeedsAttention?: boolean
}) {
  const { t } = useTranslation()
  const productValues = {
    name: product.name,
    quantity: product.quantity,
    notes: product.notes ?? ''
  }
  const [values, setValues] = useState(productValues)
  const [initial, setInitial] = useState(values)
  const [categoryEdit, setCategoryEdit] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [discardOpen, setDiscardOpen] = useState(false)
  const updatedBy = useQuery({
    queryKey: ['profile', product.updated_by],
    queryFn: () => api.profile.current(product.updated_by!),
    enabled: open && Boolean(product.updated_by)
  })
  const formId = `product-form-${product.id}`

  const category = categoryEdit ?? authoritativeProduct.category_id
  const dirty =
    JSON.stringify(values) !== JSON.stringify(initial) ||
    category !== authoritativeProduct.category_id
  const validation = useMemo(() => {
    const name = normalizeNameForStorage(values.name)
    if ([...name].length < 1 || [...name].length > PRODUCT_NAME_MAX) return t('invalidName')
    if (validateQuantity(values.quantity)) return t('invalidQuantity')
    if ([...values.notes].length > PRODUCT_NOTES_MAX) return t('invalidNotes')
    const signature = duplicateSignature(name)
    if (products.some((item) => item.id !== product.id && item.name_signature === signature))
      return t('duplicate')
    return ''
  }, [product.id, products, t, values])
  function requestClose(next: boolean) {
    if (!next && dirty) setDiscardOpen(true)
    else onOpenChange(next)
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    if (!canMutate) return
    try {
      await onSave(product, {
        name: normalizeNameForStorage(values.name),
        quantity: values.quantity,
        notes: values.notes.trim(),
        category_id: category
      })
      setInitial(values)
      setCategoryEdit(null)
      onOpenChange(false)
    } catch (reason) {
      setError(
        isProductConflict(reason)
          ? t('conflict')
          : isApiErrorCode(reason, 'household_read_only')
            ? boundaryIsPaid
              ? paidBoundaryNeedsAttention
                ? t('householdPaidAttention')
                : t('householdReadOnlyPaid')
              : t('householdReadOnly')
            : isApiErrorCode(reason, 'household_entitlement_locked')
              ? boundaryIsPaid
                ? t('householdLockedPaid')
                : t('householdLocked')
              : t('requestFailed')
      )
    }
  }

  return (
    <>
      <AppDrawer
        open={open}
        onOpenChange={requestClose}
        title={<HoldToRevealName name={product.name} notes={product.notes} />}
        className="product-drawer"
        headerAction={
          <button
            type="button"
            className="icon-button danger-quiet"
            onClick={() => setDeleteOpen(true)}
            disabled={pending || !canMutate}
            aria-label={t('delete')}
          >
            <Trash />
          </button>
        }
        footer={
          <Button
            className="drawer-save"
            type="submit"
            form={formId}
            disabled={!dirty || Boolean(validation) || pending || !canMutate}
          >
            {pending ? t('saving') : t('save')}
          </Button>
        }
      >
        <div className="product-audit" role="group" aria-label={t('updatedAt')}>
          <time dateTime={product.updated_at}>{formatAuditDate(product.updated_at)}</time>
          {product.updated_by && (
            <span
              className="audit-user"
              title={updatedBy.data?.name}
              aria-label={
                updatedBy.data ? t('updatedBy', { name: updatedBy.data.name }) : undefined
              }
            >
              <span className="audit-avatar" aria-hidden="true">
                {updatedBy.data ? nameInitial(updatedBy.data.name) : '…'}
              </span>
              <span>{updatedBy.data?.name ?? (updatedBy.isLoading ? '…' : '—')}</span>
            </span>
          )}
        </div>
        <form id={formId} className="drawer-form" onSubmit={submit}>
          <label className="notes-field">
            <span>{t('appName').includes('ה') ? 'שם המוצר' : 'Product name'}</span>
            <input
              value={values.name}
              onChange={(event) => setValues({ ...values, name: event.target.value })}
              disabled={pending || !canMutate}
              maxLength={PRODUCT_NAME_MAX * 2}
            />
          </label>
          <label>
            <span>{t('quantity')}</span>
            <input
              type="number"
              inputMode="decimal"
              min="1"
              max="999"
              step="0.01"
              value={values.quantity}
              onChange={(event) => setValues({ ...values, quantity: event.target.value })}
              disabled={pending || !canMutate}
            />
          </label>
          <label>
            <span>{t('category')}</span>
            <select
              value={category}
              disabled={pending || !canMutate}
              onChange={(event) => setCategoryEdit(event.target.value)}
            >
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {categoryLabel(t, category.name)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>
              {t('notes')} <small>{t('optional')}</small>
            </span>
            <span className="textarea-shell">
              <textarea
                value={values.notes}
                disabled={pending || !canMutate}
                onChange={(event) => setValues({ ...values, notes: event.target.value })}
                rows={4}
              />
              <button
                type="button"
                className="clear-notes-button"
                disabled={!values.notes || pending || !canMutate}
                onClick={() => setValues({ ...values, notes: '' })}
                aria-label={t('clearProductNotes')}
              >
                <Eraser />
              </button>
            </span>
            <small className="counter">
              {[...values.notes].length}/{PRODUCT_NOTES_MAX}
            </small>
          </label>
          {(validation || error) && (
            <p className="form-error" role="alert">
              {error || validation}
            </p>
          )}
          <Button
            type="button"
            variant="secondary"
            disabled={pending || !canMutate}
            onClick={() => onToggle(product)}
          >
            {product.is_picked ? t('restore') : t('pick')}
          </Button>
        </form>
      </AppDrawer>
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t('deleteTitle', { name: product.name })}
        body={t('deleteBody')}
        confirmLabel={t('delete')}
        destructive
        pending={pending || !canMutate}
        onConfirm={() => {
          if (!canMutate) return
          void onDelete(product)
            .then(() => {
              setDeleteOpen(false)
              onOpenChange(false)
            })
            .catch(() => undefined)
        }}
      />
      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title={t('discardTitle')}
        body={t('discardBody')}
        confirmLabel={t('discard')}
        onConfirm={() => {
          setDiscardOpen(false)
          onOpenChange(false)
        }}
      />
    </>
  )
}

function nameInitial(name: string) {
  return Array.from(name.trim())[0]?.toLocaleUpperCase() ?? '?'
}

function formatAuditDate(value: string) {
  return dayjs(value).format('L LT')
}
