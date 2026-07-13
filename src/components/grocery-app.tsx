import { Globe, MagnifyingGlass, Plus, SignOut, UsersThree, WifiSlash } from '@phosphor-icons/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, LayoutGroup, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { useAuth } from '../auth'
import { api, ApiError } from '../lib/api'
import {
  duplicateSignature,
  normalizeNameForStorage,
  normalizeText,
  searchProducts
} from '../lib/product'
import type { Product } from '../lib/types'
import { AdminDrawer } from './admin-drawer'
import { ProductDrawer } from './product-drawer'
import { ProductRow } from './product-row'

export function GroceryApp() {
  const { t } = useTranslation()
  const auth = useAuth()
  const client = useQueryClient()
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Product | null>(null)
  const [adminOpen, setAdminOpen] = useState(false)
  const [duplicatePulse, setDuplicatePulse] = useState('')
  const [toast, setToast] = useState('')
  const [online, setOnline] = useState(navigator.onLine)
  const [realtime, setRealtime] = useState('connecting')
  const [showConnectionWarning, setShowConnectionWarning] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const products = useQuery({
    queryKey: ['products'],
    queryFn: api.products.list,
    retry: 1,
    staleTime: 0,
    gcTime: 0
  })
  const connectionWarningEligible =
    !products.isLoading && !products.isError && (!online || realtime === 'disconnected')

  useEffect(() => {
    const online = () => {
      setOnline(true)
      setToast(t('connected'))
      void client.invalidateQueries({ queryKey: ['products'] })
    }
    const offline = () => setOnline(false)
    addEventListener('online', online)
    addEventListener('offline', offline)
    return () => {
      removeEventListener('online', online)
      removeEventListener('offline', offline)
    }
  }, [client, t])

  useEffect(() => {
    if (!toast) return
    const timeout = window.setTimeout(() => setToast(''), 3200)
    return () => window.clearTimeout(timeout)
  }, [toast])

  useEffect(() => {
    const refreshRealtimeData = () => {
      void client.invalidateQueries({ queryKey: ['products'] })
      void client.invalidateQueries({ queryKey: ['history'] })
    }
    const channel = api.realtime.subscribe(refreshRealtimeData, (status) => {
      setRealtime(
        status === 'SUBSCRIBED'
          ? 'connected'
          : status === 'CHANNEL_ERROR' || status === 'TIMED_OUT'
            ? 'disconnected'
            : 'connecting'
      )
      if (status === 'SUBSCRIBED') refreshRealtimeData()
    })
    return () => {
      void channel.unsubscribe()
    }
  }, [client])

  useEffect(() => {
    const timeout = window.setTimeout(
      () => setShowConnectionWarning(connectionWarningEligible),
      connectionWarningEligible ? 1800 : 0
    )
    return () => window.clearTimeout(timeout)
  }, [connectionWarningEligible])

  const list = useMemo(() => products.data ?? [], [products.data])
  const scored = useMemo(() => searchProducts(list, search), [list, search])
  const filtered = scored.map(({ product }) => product)
  const unpicked = filtered
    .filter((product) => !product.is_picked)
    .sort((a, b) => b.ordering_at.localeCompare(a.ordering_at) || a.id.localeCompare(b.id))
  const picked = filtered
    .filter((product) => product.is_picked)
    .sort(
      (a, b) => (b.picked_at ?? '').localeCompare(a.picked_at ?? '') || a.id.localeCompare(b.id)
    )
  const signature = duplicateSignature(search)
  const duplicate = signature
    ? list.find((product) => product.name_signature === signature)
    : undefined
  const canCreate = Boolean(normalizeText(search)) && !duplicate

  function mutationError(reason: unknown) {
    setToast(
      reason instanceof ApiError
        ? reason.code === '23505'
          ? t('duplicate')
          : reason.code === 'timeout'
            ? t('timeout')
            : t('requestFailed')
        : navigator.onLine
          ? t('requestFailed')
          : t('offline')
    )
  }
  function replaceProduct(next: Product) {
    client.setQueryData<Product[]>(['products'], (current = []) =>
      current.map((product) => (product.id === next.id ? next : product))
    )
  }
  const create = useMutation({
    mutationFn: api.products.create,
    onSuccess: (product) => {
      client.setQueryData<Product[]>(['products'], (current = []) => [
        product,
        ...current.filter((item) => item.id !== product.id)
      ])
      setSearch('')
      searchRef.current?.focus()
    },
    onError: mutationError
  })
  const adjust = useMutation({
    mutationFn: ({ product, delta }: { product: Product; delta: 1 | -1 }) =>
      api.products.adjust(product.id, delta, product.version),
    onMutate: async ({ product, delta }) => {
      await client.cancelQueries({ queryKey: ['products'] })
      const previous = client.getQueryData<Product[]>(['products'])
      replaceProduct({
        ...product,
        quantity: String(Number(product.quantity) + delta),
        version: product.version + 1
      })
      return { previous }
    },
    onSuccess: replaceProduct,
    onError: (reason, _variables, context) => {
      if (context?.previous) client.setQueryData(['products'], context.previous)
      mutationError(reason)
    }
  })
  const toggle = useMutation({
    mutationFn: api.products.toggle,
    onMutate: async (product) => {
      await client.cancelQueries({ queryKey: ['products'] })
      const previous = client.getQueryData<Product[]>(['products'])
      const now = new Date().toISOString()
      replaceProduct({
        ...product,
        is_picked: !product.is_picked,
        picked_at: product.is_picked ? null : now,
        ordering_at: now,
        version: product.version + 1
      })
      return { previous }
    },
    onSuccess: (next) => {
      replaceProduct(next)
      if (selected?.id === next.id) setSelected(next)
    },
    onError: (reason, _variables, context) => {
      if (context?.previous) client.setQueryData(['products'], context.previous)
      mutationError(reason)
    }
  })
  const update = useMutation({
    mutationFn: ({
      product,
      changes
    }: {
      product: Product
      changes: { name: string; quantity: string; notes: string }
    }) => api.products.update(product, changes),
    onSuccess: (next) => {
      replaceProduct(next)
      setSelected(next)
    }
  })
  const remove = useMutation({
    mutationFn: api.products.remove,
    onSuccess: (_, product) =>
      client.setQueryData<Product[]>(['products'], (current = []) =>
        current.filter((item) => item.id !== product.id)
      ),
    onError: mutationError
  })

  function activateCreate() {
    if (duplicate) {
      setDuplicatePulse(duplicate.id)
      setToast(t('duplicate'))
      setTimeout(() => setDuplicatePulse(''), 520)
      document
        .querySelector(`[data-product-id="${duplicate.id}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }
    if (canCreate && !create.isPending) create.mutate(normalizeNameForStorage(search))
  }

  return (
    <main className="app-shell">
      <AppHeader onAdmin={() => setAdminOpen(true)} />
      <section className="list-surface">
        <div className="list-toolbar">
          <div className="search-shell">
            <MagnifyingGlass />
            <input
              ref={searchRef}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') activateCreate()
              }}
              placeholder={t('search')}
              aria-label={t('search')}
            />
            <button
              aria-disabled={!canCreate}
              aria-label={
                canCreate
                  ? t('create', { name: search })
                  : duplicate
                    ? t('duplicate')
                    : t('create', { name: '' })
              }
              onClick={activateCreate}
            >
              <Plus weight="bold" />
            </button>
          </div>
          {connectionWarningEligible && showConnectionWarning && (
            <button
              className="connection-banner"
              onClick={() => {
                void products.refetch()
              }}
            >
              <WifiSlash />
              {online ? t('reconnecting') : t('offline')}
            </button>
          )}
        </div>
        <div className="product-scroll">
          {products.isLoading ? (
            <ListSkeleton />
          ) : products.isError ? (
            <ErrorState onRetry={() => products.refetch()} />
          ) : (
            <LayoutGroup>
              <ProductSection
                title={t('unpicked')}
                products={unpicked}
                duplicatePulse={duplicatePulse}
                onEdit={setSelected}
                onAdjust={(product, delta) => adjust.mutate({ product, delta })}
                onToggle={(product) => toggle.mutate(product)}
              />
              <div className="picked-divider">
                <span />
                {t('picked')}
                <span />
              </div>
              <ProductSection
                title=""
                products={picked}
                duplicatePulse={duplicatePulse}
                onEdit={setSelected}
                onAdjust={(product, delta) => adjust.mutate({ product, delta })}
                onToggle={(product) => toggle.mutate(product)}
              />
              {list.length === 0 && <p className="empty-state">{t('empty')}</p>}
              {search && filtered.length === 0 && <p className="empty-state">{t('noMatches')}</p>}
            </LayoutGroup>
          )}
        </div>
      </section>
      {selected && (
        <ProductDrawer
          key={selected.id}
          product={selected}
          products={list}
          open={Boolean(selected)}
          onOpenChange={(open) => !open && setSelected(null)}
          pending={update.isPending}
          onSave={async (product, changes) => {
            await update.mutateAsync({ product, changes })
          }}
          onDelete={async (product) => {
            await remove.mutateAsync(product)
          }}
          onToggle={(product) => toggle.mutate(product)}
        />
      )}
      {auth.profile?.role === 'admin' && (
        <AdminDrawer open={adminOpen} onOpenChange={setAdminOpen} />
      )}
      <AppToast message={toast} />
      <PwaUpdate />
    </main>
  )
}

function AppToast({ message }: { message: string }) {
  return (
    <AnimatePresence initial={false}>
      {message && (
        <motion.aside
          className="app-toast"
          role="status"
          initial={{ opacity: 0, y: 12, filter: 'blur(4px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          exit={{ opacity: 0, y: 8, filter: 'blur(4px)' }}
          transition={{ type: 'spring', duration: 0.3, bounce: 0 }}
        >
          {message}
        </motion.aside>
      )}
    </AnimatePresence>
  )
}

function ProductSection({
  title,
  products,
  duplicatePulse,
  onEdit,
  onAdjust,
  onToggle
}: {
  title: string
  products: Product[]
  duplicatePulse: string
  onEdit(product: Product): void
  onAdjust(product: Product, delta: 1 | -1): void
  onToggle(product: Product): void
}) {
  return (
    <section className="product-section">
      {title && (
        <h2>
          {title}
          <span>{products.length}</span>
        </h2>
      )}
      <motion.ul layout>
        <AnimatePresence initial={false}>
          {products.map((product) => (
            <ProductRow
              key={product.id}
              product={product}
              duplicatePulse={duplicatePulse === product.id}
              onEdit={() => onEdit(product)}
              onAdjust={(delta) => onAdjust(product, delta)}
              onToggle={() => onToggle(product)}
            />
          ))}
        </AnimatePresence>
      </motion.ul>
    </section>
  )
}

function AppHeader({ onAdmin }: { onAdmin(): void }) {
  const { t, i18n } = useTranslation()
  const auth = useAuth()
  return (
    <header className="app-header">
      <div>
        <span className="mini-leaf" />
        <div>
          <p>{t('tagline')}</p>
          <h1>{t('appName')}</h1>
        </div>
      </div>
      <nav>
        {auth.profile?.role === 'admin' && (
          <button className="icon-button" onClick={onAdmin} aria-label={t('admin')}>
            <UsersThree />
          </button>
        )}
        <button
          className="language-button"
          onClick={() => void i18n.changeLanguage(i18n.language === 'he' ? 'en' : 'he')}
        >
          <Globe />
          {i18n.language === 'he' ? 'EN' : 'עב'}
        </button>
        <button
          className="icon-button"
          onClick={() => void auth.signOut()}
          aria-label={t('logout')}
        >
          <SignOut />
        </button>
      </nav>
    </header>
  )
}

function ListSkeleton() {
  return (
    <div className="skeleton-list" aria-hidden="true">
      {[1, 2, 3, 4].map((item) => (
        <span key={item} />
      ))}
    </div>
  )
}
function ErrorState({ onRetry }: { onRetry(): void }) {
  const { t } = useTranslation()
  return (
    <div className="empty-state">
      <p>{t('requestFailed')}</p>
      <button onClick={onRetry}>{t('confirm')}</button>
    </div>
  )
}
function PwaUpdate() {
  const { t } = useTranslation()
  const {
    needRefresh: [needRefresh],
    updateServiceWorker
  } = useRegisterSW()
  return (
    <AnimatePresence>
      {needRefresh && (
        <motion.aside
          className="update-toast"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
        >
          <span>{t('updateReady')}</span>
          <button onClick={() => void updateServiceWorker(true)}>{t('update')}</button>
        </motion.aside>
      )}
    </AnimatePresence>
  )
}
