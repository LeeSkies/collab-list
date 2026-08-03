import { Menu } from '@base-ui/react/menu'
import {
  ArrowCounterClockwise,
  ArrowsDownUp,
  Check,
  Funnel,
  Globe,
  MagnifyingGlass,
  Plus,
  SignOut,
  UserCircle,
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
import { supabase } from '../lib/supabase'
import {
  duplicateSignature,
  normalizeNameForStorage,
  normalizeText,
  orderProductSections,
  type ProductSortMode
} from '../lib/product'
import {
  applyAuthoritativeProduct,
  ProductMutationCoordinator,
  rollbackOptimisticProduct,
  type ProductMutationState
} from '../lib/product-mutation-coordinator'
import { PRODUCT_CATEGORIES, type ProductCategory } from '../lib/product-category'
import type { Product, ProductChanges } from '../lib/types'
import { TrailingRefresh } from '../lib/trailing-refresh'
import { AccountDrawer } from './account-drawer'
import { AdminDrawer } from './admin-drawer'
import { CategoryFilterDrawer } from './category-filter-drawer'
import { ProductDrawer } from './product-drawer'
import { ProductSection } from './product-section'
import { ProductTour } from './product-tour'
import { RestoreAllDialog } from './restore-all-dialog'

const SORT_MODES: ProductSortMode[] = ['default', 'name', 'category']
const SORT_STORAGE_KEY = 'grocery-sort-mode'

export function GroceryApp() {
  const { t, i18n } = useTranslation()
  const auth = useAuth()
  const client = useQueryClient()
  const [search, setSearch] = useState('')
  const [sortMode, setSortMode] = useState<ProductSortMode>(() => {
    const stored = localStorage.getItem(SORT_STORAGE_KEY)
    return SORT_MODES.find((mode) => mode === stored) ?? 'default'
  })
  const [selected, setSelected] = useState<Product | null>(null)
  const [adminOpen, setAdminOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [categoryFilterOpen, setCategoryFilterOpen] = useState(false)
  const [categoryFilters, setCategoryFilters] = useState<ReadonlySet<ProductCategory>>(new Set())
  const [restoreAllOpen, setRestoreAllOpen] = useState(false)
  const [duplicatePulse, setDuplicatePulse] = useState('')
  const [enteringProductIds, setEnteringProductIds] = useState<ReadonlySet<string>>(new Set())
  const [toast, setToast] = useState('')
  const [online, setOnline] = useState(navigator.onLine)
  const [realtime, setRealtime] = useState('connecting')
  const [showConnectionWarning, setShowConnectionWarning] = useState(false)
  const [productTourClosed, setProductTourClosed] = useState(false)
  const mutationCoordinator = useRef(new ProductMutationCoordinator())
  const previousPendingCount = useRef<number | undefined>(undefined)
  const [mutationState, setMutationState] = useState<ProductMutationState>({
    productIds: new Set(),
    bulk: false
  })
  const [renderedAt] = useState(() => Date.now())
  const searchRef = useRef<HTMLInputElement>(null)
  const householdId = auth.profile?.household_id
  const previousHouseholdId = useRef<string | undefined>(householdId)
  const productsQueryKey = useMemo(() => ['products', householdId] as const, [householdId])
  const products = useQuery({
    queryKey: productsQueryKey,
    queryFn: ({ signal }) => api.products.list(signal),
    enabled: Boolean(householdId),
    retry: 1,
    staleTime: 0,
    gcTime: 0
  })
  const entitlement = useQuery({
    queryKey: ['household-entitlement', householdId],
    queryFn: api.household.entitlement,
    enabled: Boolean(householdId),
    retry: 1,
    staleTime: 0,
    refetchInterval: 30_000,
    refetchIntervalInBackground: true
  })
  const canMutate = entitlement.data?.can_mutate ?? true
  const showBoundaryBanner = Boolean(
    entitlement.data?.enforcement_enabled &&
    entitlement.data.access_state !== 'active_trial' &&
    entitlement.data.access_state !== 'paid_placeholder' &&
    entitlement.data.access_state !== 'paid_active'
  )
  const subscription = useQuery({
    queryKey: ['household-subscription', householdId],
    queryFn: api.household.subscription,
    enabled: Boolean(householdId && showBoundaryBanner),
    retry: 1,
    staleTime: 30_000
  })
  const boundaryIsPaid = Boolean(
    entitlement.data?.access_state === 'paid_active' ||
    (subscription.data && subscription.data.status !== 'none')
  )
  const paidBoundaryNeedsAttention = Boolean(
    boundaryIsPaid &&
    entitlement.data?.access_state === 'read_only_grace' &&
    subscription.data?.current_period_end &&
    new Date(subscription.data.current_period_end).getTime() > renderedAt &&
    subscription.data.status !== 'active' &&
    subscription.data.status !== 'trialing'
  )
  const pendingRequests = useQuery({
    queryKey: ['household-requests', householdId],
    queryFn: () => api.household.pendingRequests(householdId!),
    enabled: Boolean(householdId && auth.profile?.role === 'admin'),
    retry: 1,
    staleTime: 0
  })
  const completeProductTour = useMutation({
    mutationFn: api.profile.completeProductTour,
    onSuccess: () => setProductTourClosed(true)
  })
  const connectionWarningEligible =
    !products.isLoading && !products.isError && (!online || realtime === 'disconnected')

  useEffect(() => {
    const previous = previousHouseholdId.current
    if (!householdId) client.removeQueries({ queryKey: ['products'] })
    if (previous !== householdId) {
      if (previous) {
        client.removeQueries({ queryKey: ['products', previous], exact: true })
      }
      setSelected(null)
      setAdminOpen(false)
      setAccountOpen(false)
      setCategoryFilterOpen(false)
      setRestoreAllOpen(false)
      setCategoryFilters(new Set())
      previousHouseholdId.current = householdId
    }
  }, [client, householdId])

  useEffect(() => {
    const online = () => {
      setOnline(true)
      setToast(t('connected'))
      if (householdId) {
        void client.refetchQueries({ queryKey: productsQueryKey, type: 'active' })
        void client.refetchQueries({
          queryKey: ['household-entitlement', householdId],
          type: 'active'
        })
      }
    }
    const offline = () => setOnline(false)
    addEventListener('online', online)
    addEventListener('offline', offline)
    return () => {
      removeEventListener('online', online)
      removeEventListener('offline', offline)
    }
  }, [client, householdId, productsQueryKey, t])

  useEffect(() => {
    if (!toast) return
    const timeout = window.setTimeout(() => setToast(''), 3200)
    return () => window.clearTimeout(timeout)
  }, [toast])

  useEffect(() => {
    const count = pendingRequests.data?.length
    if (count === undefined) return
    if (previousPendingCount.current !== undefined && count > previousPendingCount.current) {
      setToast(t('newRequestNotification'))
    }
    previousPendingCount.current = count
  }, [pendingRequests.data?.length, t])

  useEffect(() => {
    if (!householdId || auth.profile?.role !== 'admin') return
    const channel = supabase
      .channel(`household-join-requests:${householdId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'household_join_requests',
          filter: `household_id=eq.${householdId}`
        },
        () => void client.invalidateQueries({ queryKey: ['household-requests', householdId] })
      )
      .subscribe()
    return () => {
      void channel.unsubscribe()
    }
  }, [auth.profile?.role, client, householdId])

  useEffect(() => {
    if (!householdId) return
    const refresher = new TrailingRefresh(
      () =>
        client.refetchQueries(
          { queryKey: productsQueryKey, type: 'active' },
          { throwOnError: true }
        ),
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
      },
      householdId
    )
    return () => {
      refresher.dispose()
      void channel.unsubscribe()
    }
  }, [client, householdId, productsQueryKey])

  useEffect(() => {
    const timeout = window.setTimeout(
      () => setShowConnectionWarning(connectionWarningEligible),
      connectionWarningEligible ? 1800 : 0
    )
    return () => window.clearTimeout(timeout)
  }, [connectionWarningEligible])

  const list = useMemo(() => products.data ?? [], [products.data])
  const selectedProduct =
    selected && selected.household_id === householdId
      ? (list.find((product) => product.id === selected.id) ?? selected)
      : null
  const categoryFilterActive =
    categoryFilters.size > 0 && categoryFilters.size < PRODUCT_CATEGORIES.length
  const filteredList = useMemo(
    () =>
      categoryFilterActive ? list.filter((product) => categoryFilters.has(product.category)) : list,
    [categoryFilterActive, categoryFilters, list]
  )
  const { unpicked, picked } = useMemo(
    () =>
      orderProductSections(filteredList, search, sortMode, i18n.resolvedLanguage ?? i18n.language),
    [filteredList, i18n.language, i18n.resolvedLanguage, search, sortMode]
  )
  const signature = duplicateSignature(search)
  const duplicate = signature
    ? list.find((product) => product.name_signature === signature)
    : undefined
  const canCreate = canMutate && Boolean(householdId && normalizeText(search)) && !duplicate

  async function refreshProducts(productId?: string) {
    try {
      await client.refetchQueries(
        { queryKey: productsQueryKey, type: 'active' },
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
      .getQueryData<Product[]>(productsQueryKey)
      ?.find((product) => product.id === productId)
    setSelected((current) => (current?.id === productId ? (latest ?? null) : current))
    return true
  }
  async function mutationError(reason: unknown, productId?: string) {
    const entitlementBoundaryError =
      reason instanceof ApiError &&
      (reason.message.includes('household_read_only') ||
        reason.message.includes('household_entitlement_locked'))
    const paidBoundary = boundaryIsPaid
    const paidAttention = paidBoundaryNeedsAttention
    if (entitlementBoundaryError && householdId) {
      void client
        .fetchQuery({
          queryKey: ['household-entitlement', householdId],
          queryFn: api.household.entitlement,
          staleTime: 0
        })
        .catch(() => undefined)
      void client
        .fetchQuery({
          queryKey: ['household-subscription', householdId],
          queryFn: api.household.subscription,
          staleTime: 0
        })
        .catch(() => undefined)
    }
    setToast(
      isProductConflict(reason)
        ? t('conflict')
        : reason instanceof ApiError
          ? reason.code === '23505'
            ? t('duplicate')
            : reason.message.includes('household_read_only')
              ? paidBoundary
                ? paidAttention
                  ? t('householdPaidAttention')
                  : t('householdReadOnlyPaid')
                : t('householdReadOnly')
              : reason.message.includes('household_entitlement_locked')
                ? paidBoundary
                  ? t('householdLockedPaid')
                  : t('householdLocked')
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
  function completeEntrance(productId: string) {
    setEnteringProductIds((current) => {
      if (!current.has(productId)) return current
      const next = new Set(current)
      next.delete(productId)
      return next
    })
  }
  function replaceProduct(next: Product) {
    if (!householdId || next.household_id !== householdId) return
    client.setQueryData<Product[]>(productsQueryKey, (current = []) =>
      current.map((product) => (product.id === next.id ? next : product))
    )
  }
  function applyAuthoritative(next: Product) {
    if (!householdId || next.household_id !== householdId) return
    client.setQueryData<Product[]>(productsQueryKey, (current = []) =>
      applyAuthoritativeProduct(current, next)
    )
  }
  function rollbackProduct(optimistic: Product, previous: Product) {
    if (!householdId || optimistic.household_id !== householdId) return
    client.setQueryData<Product[]>(productsQueryKey, (current = []) =>
      rollbackOptimisticProduct(current, optimistic, previous)
    )
  }
  const create = useMutation({
    mutationFn: api.products.create,
    onSuccess: (product) => {
      if (!householdId || product.household_id !== householdId) return
      setEnteringProductIds((current) => new Set(current).add(product.id))
      client.setQueryData<Product[]>(productsQueryKey, (current = []) => [
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
      await client.cancelQueries({ queryKey: productsQueryKey })
      const previous =
        client.getQueryData<Product[]>(productsQueryKey)?.find((item) => item.id === product.id) ??
        product
      const optimistic = {
        ...previous,
        quantity: String(Number(previous.quantity) + delta),
        version: previous.version + 1
      }
      replaceProduct(optimistic)
      return { previous, optimistic }
    },
    onSuccess: (next) => {
      applyAuthoritative(next)
      const applied =
        client.getQueryData<Product[]>(productsQueryKey)?.find((item) => item.id === next.id) ??
        next
      if (householdId && selected?.id === applied.id && selected.household_id === householdId)
        setSelected(applied)
    },
    onError: async (reason, variables, context) => {
      if (context) rollbackProduct(context.optimistic, context.previous)
      await mutationError(reason, variables.product.id)
    }
  })
  const toggle = useMutation({
    mutationFn: api.products.toggle,
    onMutate: async (product) => {
      await client.cancelQueries({ queryKey: productsQueryKey })
      const previous =
        client.getQueryData<Product[]>(productsQueryKey)?.find((item) => item.id === product.id) ??
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
      applyAuthoritative(next)
      const applied =
        client.getQueryData<Product[]>(productsQueryKey)?.find((item) => item.id === next.id) ??
        next
      if (householdId && selected?.id === applied.id && selected.household_id === householdId)
        setSelected(applied)
    },
    onError: async (reason, variables, context) => {
      if (context) rollbackProduct(context.optimistic, context.previous)
      await mutationError(reason, variables.id)
    }
  })
  const update = useMutation({
    mutationFn: ({ product, changes }: { product: Product; changes: ProductChanges }) =>
      api.products.update(product, changes),
    onSuccess: (next) => {
      applyAuthoritative(next)
      const applied =
        client.getQueryData<Product[]>(productsQueryKey)?.find((item) => item.id === next.id) ??
        next
      if (householdId && applied.household_id === householdId) setSelected(applied)
    },
    onError: (reason, variables) => mutationError(reason, variables.product.id)
  })
  const remove = useMutation({
    mutationFn: api.products.remove,
    onSuccess: (_, product) => {
      if (!householdId || product.household_id !== householdId) return
      client.setQueryData<Product[]>(productsQueryKey, (current = []) =>
        current.filter((item) => item.id !== product.id)
      )
    },
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
      if (!householdId) return
      const restoredById = new Map(
        restored
          .filter((product) => product.household_id === householdId)
          .map((product) => [product.id, product])
      )
      client.setQueryData<Product[]>(productsQueryKey, (current = []) =>
        current.map((product) => restoredById.get(product.id) ?? product)
      )
      setRestoreAllOpen(false)
    },
    onError: (reason) => mutationError(reason)
  })

  function activateCreate() {
    if (!canMutate) return
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
    if (!canMutate || !lockProduct(product.id)) return
    try {
      await adjust.mutateAsync({ product, delta })
    } catch {
      // The mutation callback already reconciles and reports the failure.
    } finally {
      unlockProduct(product.id)
    }
  }

  async function toggleProduct(product: Product) {
    if (!canMutate || !lockProduct(product.id)) return
    try {
      await toggle.mutateAsync(product)
    } catch {
      // The mutation callback already reconciles and reports the failure.
    } finally {
      unlockProduct(product.id)
    }
  }

  async function saveProduct(product: Product, changes: ProductChanges) {
    if (!canMutate) return
    if (!lockProduct(product.id)) throw new ApiError('busy', 'Product update already in progress')
    try {
      await update.mutateAsync({ product, changes })
    } finally {
      unlockProduct(product.id)
    }
  }

  async function deleteProduct(product: Product) {
    if (!canMutate) return
    if (!lockProduct(product.id)) throw new ApiError('busy', 'Product update already in progress')
    try {
      await remove.mutateAsync(product)
    } finally {
      unlockProduct(product.id)
    }
  }

  async function restoreAllProducts(options: { clearNotes: boolean; resetQuantities: boolean }) {
    if (!canMutate || !lockBulk()) return
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
      <AppHeader
        onAccount={() => setAccountOpen(true)}
        onAdmin={() => setAdminOpen(true)}
        pendingRequestCount={pendingRequests.data?.length ?? 0}
      />
      {showBoundaryBanner && (
        <div className="entitlement-banner" role="status">
          {entitlement.data?.access_state === 'read_only_grace'
            ? boundaryIsPaid
              ? paidBoundaryNeedsAttention
                ? t('householdPaidAttention')
                : t('householdReadOnlyPaid')
              : t('householdReadOnly')
            : boundaryIsPaid
              ? t('householdLockedPaid')
              : t('householdLocked')}
        </div>
      )}
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
                disabled={!canCreate}
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
                groupByCategory={sortMode === 'category' && !normalizeText(search)}
                animateChanges={!categoryFilterOpen}
                headerAction={
                  <div className="list-header-actions">
                    <SortMenu
                      mode={sortMode}
                      onChange={(next) => {
                        localStorage.setItem(SORT_STORAGE_KEY, next)
                        setSortMode(next)
                      }}
                    />
                    <button
                      type="button"
                      className={`list-control-button filter-button ${categoryFilterActive ? 'is-active' : ''}`}
                      aria-label={t('filterCategories')}
                      aria-pressed={categoryFilterActive}
                      onClick={() => setCategoryFilterOpen(true)}
                    >
                      <Funnel weight="bold" />
                    </button>
                  </div>
                }
                duplicatePulse={duplicatePulse}
                enteringProductIds={enteringProductIds}
                onEntranceComplete={completeEntrance}
                busyProductIds={mutationState.productIds}
                bulkBusy={mutationState.bulk}
                canMutate={canMutate}
                onEdit={setSelected}
                onAdjust={adjustProduct}
                onToggle={toggleProduct}
              />
              <ProductSection
                title={t('picked')}
                products={picked}
                groupByCategory={sortMode === 'category' && !normalizeText(search)}
                animateChanges={!categoryFilterOpen}
                showCount={false}
                headerAction={
                  <button
                    className="icon-button restore-all-button"
                    disabled={
                      !canMutate ||
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
                enteringProductIds={enteringProductIds}
                onEntranceComplete={completeEntrance}
                busyProductIds={mutationState.productIds}
                bulkBusy={mutationState.bulk}
                canMutate={canMutate}
                onEdit={setSelected}
                onAdjust={adjustProduct}
                onToggle={toggleProduct}
              />
              {list.length === 0 && <p className="empty-state">{t('empty')}</p>}
              {(search || categoryFilterActive) && unpicked.length + picked.length === 0 && (
                <p className="empty-state">
                  {categoryFilterActive ? t('noFilteredProducts') : t('noMatches')}
                </p>
              )}
            </LayoutGroup>
          )}
        </div>
      </section>
      {selected && selectedProduct && (
        <ProductDrawer
          key={selected.id}
          product={selected}
          authoritativeProduct={selectedProduct}
          products={list}
          open={Boolean(selectedProduct)}
          onOpenChange={(open) => !open && setSelected(null)}
          pending={mutationState.bulk || mutationState.productIds.has(selectedProduct.id)}
          onSave={saveProduct}
          onDelete={deleteProduct}
          onToggle={toggleProduct}
          canMutate={canMutate}
          boundaryIsPaid={boundaryIsPaid}
          paidBoundaryNeedsAttention={paidBoundaryNeedsAttention}
        />
      )}
      <AccountDrawer open={accountOpen} onOpenChange={setAccountOpen} />
      {auth.profile?.role === 'admin' && (
        <AdminDrawer open={adminOpen} onOpenChange={setAdminOpen} canMutate={canMutate} />
      )}
      <CategoryFilterDrawer
        open={categoryFilterOpen}
        onOpenChange={setCategoryFilterOpen}
        selectedCategories={categoryFilters}
        onChange={setCategoryFilters}
      />
      <RestoreAllDialog
        key={restoreAllOpen ? 'restore-open' : 'restore-closed'}
        open={restoreAllOpen}
        onOpenChange={setRestoreAllOpen}
        pending={mutationState.bulk}
        canMutate={canMutate}
        onConfirm={(options) => void restoreAllProducts(options)}
      />
      <AppToast message={toast} />
      <PwaUpdate />
      {auth.profile?.household_id &&
        auth.profile.product_tour_completed_at === null &&
        !productTourClosed && (
          <ProductTour
            key={`${auth.profile.id}-${auth.profile.household_id}`}
            role={auth.profile.role}
            onComplete={async () => {
              await completeProductTour.mutateAsync()
              if (auth.refreshProfile) await auth.refreshProfile().catch(() => undefined)
            }}
          />
        )}
    </main>
  )
}

function SortMenu({
  mode,
  onChange
}: {
  mode: ProductSortMode
  onChange(mode: ProductSortMode): void
}) {
  const { t } = useTranslation()
  return (
    <Menu.Root>
      <Menu.Trigger
        className={`list-control-button sort-button ${mode !== 'default' ? 'is-active' : ''}`}
        aria-label={t('sortMode', { mode: t(`sort_${mode}`) })}
      >
        <ArrowsDownUp weight="bold" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner className="sort-menu-positioner" sideOffset={6} align="end">
          <Menu.Popup className="sort-menu-popup">
            <Menu.RadioGroup value={mode} onValueChange={(next: ProductSortMode) => onChange(next)}>
              {SORT_MODES.map((option) => (
                <Menu.RadioItem key={option} className="sort-menu-item" value={option} closeOnClick>
                  <span>{t(`sort_${option}`)}</span>
                  <Menu.RadioItemIndicator className="sort-menu-indicator">
                    <Check weight="bold" />
                  </Menu.RadioItemIndicator>
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
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

function AppHeader({
  onAccount,
  onAdmin,
  pendingRequestCount
}: {
  onAccount(): void
  onAdmin(): void
  pendingRequestCount: number
}) {
  const { t, i18n } = useTranslation()
  const auth = useAuth()
  return (
    <header className="app-header">
      <div>
        <span className="mini-leaf" />
        <h1>{t('appName')}</h1>
      </div>
      <nav>
        <button className="icon-button" onClick={onAccount} aria-label={t('account')}>
          <UserCircle />
        </button>
        {auth.profile?.role === 'admin' && (
          <button
            className="icon-button admin-menu-button"
            onClick={onAdmin}
            aria-label={t('admin')}
          >
            <UsersThree />
            {pendingRequestCount > 0 && (
              <span className="admin-pending-badge" aria-label={`${pendingRequestCount}`}>
                {pendingRequestCount}
              </span>
            )}
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
