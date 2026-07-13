import { ClockCounterClockwise, Trash } from '@phosphor-icons/react'
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
import type { PickHistory, Product } from '../lib/types'
import { Button } from './ui/button'
import { ConfirmDialog, Sheet } from './sheet'

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
  const [historyOpen, setHistoryOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [discardOpen, setDiscardOpen] = useState(false)
  const history = useQuery({
    queryKey: ['history', product.id],
    queryFn: () => api.history.list(product.id),
    enabled: open
  })
  const latestPick = history.data?.[0]

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
      <Sheet
        open={open}
        onOpenChange={requestClose}
        title={t('edit', { name: product.name })}
        className="product-sheet"
      >
        <div className="drawer-tools">
          <button
            className="icon-button danger-quiet"
            onClick={() => setDeleteOpen(true)}
            aria-label={t('delete')}
          >
            <Trash />
          </button>
        </div>
        <div className="history-summary">
          <span>
            {history.isLoading
              ? t('historyLoading')
              : history.isError
                ? t('requestFailed')
                : latestPick
                  ? t('lastPicked', { date: relativeDate(latestPick.picked_at, t) })
                  : t('noHistory')}
          </span>
          <button
            className="icon-button"
            onClick={() => {
              setHistoryOpen(true)
              void history.refetch()
            }}
            aria-label={t('history')}
          >
            <ClockCounterClockwise />
          </button>
        </div>
        <form className="drawer-form" onSubmit={submit}>
          <label>
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
            <textarea
              value={values.notes}
              onChange={(event) => setValues({ ...values, notes: event.target.value })}
              rows={4}
            />
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
          <Button
            className="drawer-save"
            type="submit"
            size="lg"
            disabled={!dirty || Boolean(validation) || pending}
          >
            {pending ? t('saving') : t('save')}
          </Button>
        </form>
      </Sheet>
      <HistoryDrawer
        product={product}
        entries={history.data}
        isLoading={history.isLoading}
        isError={history.isError}
        open={historyOpen}
        onOpenChange={setHistoryOpen}
      />
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

function HistoryDrawer({
  product,
  entries,
  isLoading,
  isError,
  open,
  onOpenChange
}: {
  product: Product
  entries?: PickHistory[]
  isLoading: boolean
  isError: boolean
  open: boolean
  onOpenChange(open: boolean): void
}) {
  const { t } = useTranslation()
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t('history')}
      description={product.name}
      className="history-sheet"
    >
      <div className="history-list">
        {isLoading ? (
          <p>{t('historyLoading')}</p>
        ) : isError ? (
          <p className="empty-note">{t('requestFailed')}</p>
        ) : entries?.length ? (
          entries.map((entry) => (
            <article key={entry.id}>
              <span className="history-avatar" aria-hidden="true">
                {emailInitial(entry.picked_by_email)}
              </span>
              <div>
                <strong>{relativeDate(entry.picked_at, t)}</strong>
                <span>{t('pickedBy', { email: entry.picked_by_email })}</span>
              </div>
              <time>{dayjs(entry.picked_at).format('LT')}</time>
            </article>
          ))
        ) : (
          <p className="empty-note">{t('noHistory')}</p>
        )}
      </div>
    </Sheet>
  )
}

function emailInitial(email: string) {
  return Array.from(email.trim())[0]?.toLocaleUpperCase() ?? '?'
}

function relativeDate(value: string, t: (key: string) => string) {
  const date = dayjs(value)
  const today = dayjs()
  if (date.isSame(today, 'day')) return t('today')
  if (date.isSame(today.subtract(1, 'day'), 'day')) return t('yesterday')
  return date.format('L')
}
