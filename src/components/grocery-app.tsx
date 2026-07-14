import {
  ArrowCounterClockwise,
  Globe,
  MagnifyingGlass,
  Plus,
  SignOut,
  UsersThree,
  WifiSlash,
  X
} from '@phosphor-icons/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, LayoutGroup, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { useAuth } from '../auth'
import { api, ApiError, isProductConflict } from '../lib/api'
import {
  duplicateSignature,
  normalizeNameForStorage,
  normalizeText,
  searchProducts
} from '../lib/product'
import type { Product } from '../lib/types'
import { AdminDrawer } from './admin-drawer'
import { ProductDrawer } from './product-drawer'
import { ProductSection } from './product-section'
import { RestoreAllDialog } from './restore-all-dialog'

export function GroceryApp() {
  const { t } = useTranslation()
  const auth = useAuth()
  const client = useQueryClient()
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Product | null>(null)
  const [adminOpen, setAdminOpen] = useState(false)
  const [restoreAllOpen, setRestoreAllOpen] = useState(false)
  const [duplicatePulse, setDuplicatePulse] = useState('')
  const [toast, setToast] = useState('')
  const [online, setOnline] = useState(navigator.onLine)
  const [realtime, setRealtime] = useState('connecting')
  const [showConnectionWarning, setShowConnectionWarning] = useState(false)
  const busyProductsRef = useRef(new Set<string>())
  const [busyProductIds, setBusyProductIds] = useState<ReadonlySet<string>>(new Set())
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

  async function refreshProducts(productId?: string) {
    await client.invalidateQueries({ queryKey: ['products'] })
    if (!productId) return
    const latest = client
      .getQueryData<Product[]>(['products'])
      ?.find((product) => product.id === productId)
    if (latest) setSelected((current) => (current?.id === productId ? latest : current))
  }
  function mutationError(reason: unknown, productId?: string) {
    if (isProductConflict(reason)) void refreshProducts(productId)
    setToast(
      isProductConflict(reason)
        ? t('conflict')
        : reason instanceof ApiError
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
  function lockProduct(productId: string) {
    if (busyProductsRef.current.has(productId)) return false
    busyProductsRef.current.add(productId)
    setBusyProductIds(new Set(busyProductsRef.current))
    return true
  }
  function unlockProduct(productId: string) {
    busyProductsRef.current.delete(productId)
    setBusyProductIds(new Set(busyProductsRef.current))
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
    onError: (reason) => mutationError(reason)
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
      mutationError(reason, _variables.product.id)
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
      mutationError(reason, _variables.id)
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
    },
    onError: (reason, variables) => {
      if (isProductConflict(reason)) void refreshProducts(variables.product.id)
    }
  })
  const remove = useMutation({
    mutationFn: api.products.remove,
    onSuccess: (_, product) =>
      client.setQueryData<Product[]>(['products'], (current = []) =>
        current.filter((item) => item.id !== product.id)
      ),
    onError: (reason, product) => mutationError(reason, product.id)
  })
  const restoreAll = useMutation({
    mutationFn: ({
      clearNotes,
      resetQuantities
    }: {
      clearNotes: boolean
      resetQuantities: boolean
    }) => api.products.restoreAll(clearNotes, resetQuantities),
    onSuccess: (restored) => {
      const restoredById = new Map(restored.map((product) => [product.id, product]))
      client.setQueryData<Product[]>(['products'], (current = []) =>
        current.map((product) => restoredById.get(product.id) ?? product)
      )
      setRestoreAllOpen(false)
    },
    onError: (reason) => mutationError(reason)
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

  function adjustProduct(product: Product, delta: 1 | -1) {
    if (!lockProduct(product.id)) return
    adjust.mutate({ product, delta }, { onSettled: () => unlockProduct(product.id) })
  }

  function toggleProduct(product: Product) {
    if (!lockProduct(product.id)) return
    toggle.mutate(product, { onSettled: () => unlockProduct(product.id) })
  }

  async function saveProduct(
    product: Product,
    changes: { name: string; quantity: string; notes: string }
  ) {
    if (!lockProduct(product.id)) throw new ApiError('busy', 'Product update already in progress')
    try {
      await update.mutateAsync({ product, changes })
    } finally {
      unlockProduct(product.id)
    }
  }

  async function deleteProduct(product: Product) {
    if (!lockProduct(product.id)) throw new ApiError('busy', 'Product update already in progress')
    try {
      await remove.mutateAsync(product)
    } finally {
      unlockProduct(product.id)
    }
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
            <div className="search-actions">
              <AnimatePresence initial={false}>
                {search && (
                  <motion.button
                    key="clear-search"
                    className="search-clear"
                    type="button"
                    aria-label={t('clearSearch')}
                    initial={{ opacity: 0, scale: 0.25, filter: 'blur(4px)' }}
                    animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
                    exit={{ opacity: 0, scale: 0.25, filter: 'blur(4px)' }}
                    transition={{ type: 'spring', duration: 0.3, bounce: 0 }}
                    onClick={() => {
                      setSearch('')
                      searchRef.current?.focus()
                    }}
                  >
                    <X weight="bold" />
                  </motion.button>
                )}
              </AnimatePresence>
              <button
                className="search-add"
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
                busyProductIds={busyProductIds}
                onEdit={setSelected}
                onAdjust={adjustProduct}
                onToggle={toggleProduct}
              />
              <ProductSection
                title={t('picked')}
                products={picked}
                showCount={false}
                headerAction={
                  <button
                    className="icon-button restore-all-button"
                    disabled={!list.some((product) => product.is_picked)}
                    onClick={() => setRestoreAllOpen(true)}
                    aria-label={t('restoreAll')}
                  >
                    <ArrowCounterClockwise weight="bold" />
                  </button>
                }
                duplicatePulse={duplicatePulse}
                busyProductIds={busyProductIds}
                onEdit={setSelected}
                onAdjust={adjustProduct}
                onToggle={toggleProduct}
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
          pending={busyProductIds.has(selected.id)}
          onSave={saveProduct}
          onDelete={deleteProduct}
          onToggle={toggleProduct}
        />
      )}
      {auth.profile?.role === 'admin' && (
        <AdminDrawer open={adminOpen} onOpenChange={setAdminOpen} />
      )}
      <RestoreAllDialog
        key={restoreAllOpen ? 'restore-open' : 'restore-closed'}
        open={restoreAllOpen}
        onOpenChange={setRestoreAllOpen}
        pending={restoreAll.isPending}
        onConfirm={(options) => restoreAll.mutate(options)}
      />
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

function AppHeader({ onAdmin }: { onAdmin(): void }) {
  const { t, i18n } = useTranslation()
  const auth = useAuth()
  return (
    <header className="app-header">
      <div>
        <span className="mini-leaf" />
        <h1>{t('appName')}</h1>
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
