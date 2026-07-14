import { Eraser, Trash } from '@phosphor-icons/react'
import { useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { api, ApiError } from '../lib/api'
import {
  duplicateSignature,
  normalizeNameForStorage,
  PRODUCT_NAME_MAX,
  PRODUCT_NOTES_MAX,
  validateQuantity
} from '../lib/product'
import type { Product } from '../lib/types'
import { AppDrawer, ConfirmDialog } from './drawer'
import { HoldToRevealName } from './hold-to-reveal-name'
import { Button } from './ui/button'

export function ProductDrawer({
  product,
  products,
  open,
  onOpenChange,
  onSave,
  onDelete,
  onToggle,
  pending
}: {
  product: Product
  products: Product[]
  open: boolean
  onOpenChange(open: boolean): void
  onSave(
    product: Product,
    changes: { name: string; quantity: string; notes: string }
  ): Promise<void>
  onDelete(product: Product): Promise<void>
  onToggle(product: Product): void
  pending: boolean
}) {
  const { t } = useTranslation()
  const productValues = {
    name: product.name,
    quantity: product.quantity,
    notes: product.notes ?? ''
  }
  const [values, setValues] = useState(productValues)
  const [initial, setInitial] = useState(values)
  const [error, setError] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [discardOpen, setDiscardOpen] = useState(false)
  const updatedBy = useQuery({
    queryKey: ['profile', product.updated_by],
    queryFn: () => api.profile.current(product.updated_by!),
    enabled: open && Boolean(product.updated_by)
  })
  const formId = `product-form-${product.id}`

  const dirty = JSON.stringify(values) !== JSON.stringify(initial)
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
    try {
      await onSave(product, {
        name: normalizeNameForStorage(values.name),
        quantity: values.quantity,
        notes: values.notes.trim()
      })
      setInitial(values)
      onOpenChange(false)
    } catch (reason) {
      setError(
        reason instanceof ApiError && reason.code === '40001' ? t('conflict') : t('requestFailed')
      )
    }
  }

  return (
    <>
      <AppDrawer
        open={open}
        onOpenChange={requestClose}
        title={<HoldToRevealName name={product.name} />}
        className="product-drawer"
        headerAction={
          <button
            className="icon-button danger-quiet"
            onClick={() => setDeleteOpen(true)}
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
            size="lg"
            disabled={!dirty || Boolean(validation) || pending}
          >
            {pending ? t('saving') : t('save')}
          </Button>
        }
      >
        <dl className="product-audit">
          <div>
            <dt>{t('createdAt')}</dt>
            <dd>
              <time dateTime={product.created_at}>{formatAuditDate(product.created_at)}</time>
            </dd>
          </div>
          <div>
            <dt>{t('updatedAt')}</dt>
            <dd className="audit-update">
              <time dateTime={product.updated_at}>{formatAuditDate(product.updated_at)}</time>
              {product.updated_by && (
                <span
                  className="audit-user"
                  title={updatedBy.data?.email}
                  aria-label={
                    updatedBy.data ? t('updatedBy', { email: updatedBy.data.email }) : undefined
                  }
                >
                  <span className="audit-avatar" aria-hidden="true">
                    {updatedBy.data ? emailInitial(updatedBy.data.email) : '…'}
                  </span>
                  <span>{updatedBy.data?.email ?? (updatedBy.isLoading ? '…' : '—')}</span>
                </span>
              )}
            </dd>
          </div>
        </dl>
        <form id={formId} className="drawer-form" onSubmit={submit}>
          <label className="notes-field">
            <span>{t('appName').includes('ה') ? 'שם המוצר' : 'Product name'}</span>
            <input
              value={values.name}
              onChange={(event) => setValues({ ...values, name: event.target.value })}
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
            />
          </label>
          <label>
            <span>
              {t('notes')} <small>{t('optional')}</small>
            </span>
            <span className="textarea-shell">
              <textarea
                value={values.notes}
                onChange={(event) => setValues({ ...values, notes: event.target.value })}
                rows={4}
              />
              <button
                type="button"
                className="clear-notes-button"
                disabled={!values.notes}
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
          <Button type="button" variant="secondary" size="lg" onClick={() => onToggle(product)}>
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
        onConfirm={() => {
          setDeleteOpen(false)
          void onDelete(product).then(() => onOpenChange(false))
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

function emailInitial(email: string) {
  return Array.from(email.trim())[0]?.toLocaleUpperCase() ?? '?'
}

function formatAuditDate(value: string) {
  return dayjs(value).format('L LT')
}
