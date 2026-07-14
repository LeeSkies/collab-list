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
import {
  ProductMutationCoordinator,
  rollbackOptimisticProduct,
  type ProductMutationState
} from '../lib/product-mutation-coordinator'
import type { Product } from '../lib/types'
import { TrailingRefresh } from '../lib/trailing-refresh'
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
  const mutationCoordinator = useRef(new ProductMutationCoordinator())
  const [mutationState, setMutationState] = useState<ProductMutationState>({
    productIds: new Set(),
    bulk: false
  })
  const searchRef = useRef<HTMLInputElement>(null)
  const products = useQuery({
    queryKey: ['products'],
    queryFn: ({ signal }) => api.products.list(signal),
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
      void client.refetchQueries({ queryKey: ['products'], type: 'active' })
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
    const refresher = new TrailingRefresh(
      () =>
        client.refetchQueries({ queryKey: ['products'], type: 'active' }, { throwOnError: true }),
      100
    )
    const channel = api.realtime.subscribe(
      () => refresher.schedule(),
      (status) => {
        setRealtime(
          status === 'SUBSCRIBED'
            ? 'connected'
            : status === 'CHANNEL_ERROR' || status === 'TIMED_OUT'
              ? 'disconnected'
              : 'connecting'
        )
        if (status === 'SUBSCRIBED') refresher.runNow()
      }
    )
    return () => {
      refresher.dispose()
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
    try {
      await client.refetchQueries(
        { queryKey: ['products'], type: 'active' },
        { throwOnError: true }
      )
    } catch {
      if (productId) {
        setSelected((current) => (current?.id === productId ? null : current))
      }
      return false
    }
    if (!productId) return
    const latest = client
      .getQueryData<Product[]>(['products'])
      ?.find((product) => product.id === productId)
    setSelected((current) => (current?.id === productId ? (latest ?? null) : current))
    return true
  }
  async function mutationError(reason: unknown, productId?: string) {
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
    if (isProductConflict(reason) || (reason instanceof ApiError && reason.code === 'timeout')) {
      await refreshProducts(productId)
    }
  }
  function syncMutationState() {
    setMutationState(mutationCoordinator.current.snapshot())
  }
  function lockProduct(productId: string) {
    const locked = mutationCoordinator.current.lockProduct(productId)
    if (locked) syncMutationState()
    return locked
  }
  function unlockProduct(productId: string) {
    mutationCoordinator.current.unlockProduct(productId)
    syncMutationState()
  }
  function lockBulk() {
    const locked = mutationCoordinator.current.lockBulk()
    if (locked) syncMutationState()
    return locked
  }
  function unlockBulk() {
    mutationCoordinator.current.unlockBulk()
    syncMutationState()
  }
  function replaceProduct(next: Product) {
    client.setQueryData<Product[]>(['products'], (current = []) =>
      current.map((product) => (product.id === next.id ? next : product))
    )
  }
  function rollbackProduct(optimistic: Product, previous: Product) {
    client.setQueryData<Product[]>(['products'], (current = []) =>
      rollbackOptimisticProduct(current, optimistic, previous)
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
      const previous =
        client.getQueryData<Product[]>(['products'])?.find((item) => item.id === product.id) ??
        product
      const optimistic = {
        ...previous,
        quantity: String(Number(previous.quantity) + delta),
        version: previous.version + 1
      }
      replaceProduct(optimistic)
      return { previous, optimistic }
    },
    onSuccess: replaceProduct,
    onError: async (reason, variables, context) => {
      if (context) rollbackProduct(context.optimistic, context.previous)
      await mutationError(reason, variables.product.id)
    }
  })
  const toggle = useMutation({
    mutationFn: api.products.toggle,
    onMutate: async (product) => {
      await client.cancelQueries({ queryKey: ['products'] })
      const previous =
        client.getQueryData<Product[]>(['products'])?.find((item) => item.id === product.id) ??
        product
      const now = new Date().toISOString()
      const optimistic = {
        ...previous,
        is_picked: !previous.is_picked,
        picked_at: previous.is_picked ? null : now,
        ordering_at: now,
        version: previous.version + 1
      }
      replaceProduct(optimistic)
      return { previous, optimistic }
    },
    onSuccess: (next) => {
      replaceProduct(next)
      if (selected?.id === next.id) setSelected(next)
    },
    onError: async (reason, variables, context) => {
      if (context) rollbackProduct(context.optimistic, context.previous)
      await mutationError(reason, variables.id)
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
    onError: (reason, variables) => mutationError(reason, variables.product.id)
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

  async function adjustProduct(product: Product, delta: 1 | -1) {
    if (!lockProduct(product.id)) return
    try {
      await adjust.mutateAsync({ product, delta })
    } catch {
      // The mutation callback already reconciles and reports the failure.
    } finally {
      unlockProduct(product.id)
    }
  }

  async function toggleProduct(product: Product) {
    if (!lockProduct(product.id)) return
    try {
      await toggle.mutateAsync(product)
    } catch {
      // The mutation callback already reconciles and reports the failure.
    } finally {
      unlockProduct(product.id)
    }
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

  async function restoreAllProducts(options: { clearNotes: boolean; resetQuantities: boolean }) {
    if (!lockBulk()) return
    try {
      await restoreAll.mutateAsync(options)
    } catch {
      // The mutation callback already reports the failure; the final refresh is authoritative.
    } finally {
      try {
        await refreshProducts()
      } finally {
        unlockBulk()
      }
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
                busyProductIds={mutationState.productIds}
                bulkBusy={mutationState.bulk}
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
                    disabled={
                      !list.some((product) => product.is_picked) ||
                      mutationState.bulk ||
                      mutationState.productIds.size > 0
                    }
                    onClick={() => setRestoreAllOpen(true)}
                    aria-label={t('restoreAll')}
                  >
                    <ArrowCounterClockwise weight="bold" />
                  </button>
                }
                duplicatePulse={duplicatePulse}
                busyProductIds={mutationState.productIds}
                bulkBusy={mutationState.bulk}
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
          pending={mutationState.bulk || mutationState.productIds.has(selected.id)}
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
        pending={mutationState.bulk}
        onConfirm={(options) => void restoreAllProducts(options)}
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
