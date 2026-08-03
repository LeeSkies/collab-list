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
import { useEffect, useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { useAuth } from '../auth'
import { api } from '../lib/api'
import { supabase } from '../lib/supabase'
import { normalizeText, type ProductSortMode } from '../lib/product'
import type { ProductCategory } from '../lib/product-category'
import type { Product } from '../lib/types'
import { useGroceryList } from '../hooks/use-grocery-list'
import { Button } from './ui/button'
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
  const [productTourClosed, setProductTourClosed] = useState(false)
  const previousPendingCount = useRef<number | undefined>(undefined)
  const previousHouseholdId = useRef<string | undefined>(undefined)
  const [renderedAt] = useState(() => Date.now())
  const searchRef = useRef<HTMLInputElement>(null)
  const householdId = auth.profile?.household_id
  const locale = i18n.resolvedLanguage ?? i18n.language

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

  const refreshBoundaryQueries = useCallback(() => {
    if (!householdId) return
    void client.refetchQueries({ queryKey: ['household-entitlement', householdId], type: 'active' })
    void client.refetchQueries({
      queryKey: ['household-subscription', householdId],
      type: 'active'
    })
  }, [client, householdId])

  const grocery = useGroceryList({
    householdId,
    canMutate,
    boundaryIsPaid,
    paidBoundaryNeedsAttention,
    search,
    sortMode,
    categoryFilters,
    locale,
    t,
    selectedId: selected?.id ?? null,
    onSelectedChange: setSelected,
    onEntranceAdded: (productId) =>
      setEnteringProductIds((current) => new Set(current).add(productId)),
    onDuplicatePulse: (productId) => {
      setDuplicatePulse(productId)
      window.setTimeout(() => setDuplicatePulse(''), 520)
    },
    onCreated: () => {
      setSearch('')
      searchRef.current?.focus()
    },
    onRestoreAllClosed: () => setRestoreAllOpen(false),
    onRefreshEntitlement: refreshBoundaryQueries,
    onToast: setToast
  })

  useEffect(() => {
    const previous = previousHouseholdId.current
    if (previous !== householdId) {
      setSelected(null)
      setAdminOpen(false)
      setAccountOpen(false)
      setCategoryFilterOpen(false)
      setRestoreAllOpen(false)
      setCategoryFilters(new Set())
      previousHouseholdId.current = householdId
    }
  }, [householdId])

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

  function completeEntrance(productId: string) {
    setEnteringProductIds((current) => {
      if (!current.has(productId)) return current
      const next = new Set(current)
      next.delete(productId)
      return next
    })
  }

  const {
    products,
    list,
    unpicked,
    picked,
    duplicate,
    canCreate,
    categoryFilterActive,
    mutationState,
    online,
    showConnectionWarning,
    connectionWarningEligible,
    activateCreate,
    adjustProduct,
    toggleProduct,
    saveProduct,
    deleteProduct,
    restoreAllProducts
  } = grocery
  const selectedProduct =
    selected && selected.household_id === householdId
      ? (list.find((product) => product.id === selected.id) ?? selected)
      : null

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
                type="button"
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
              type="button"
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
                    type="button"
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
        <button type="button" className="icon-button" onClick={onAccount} aria-label={t('account')}>
          <UserCircle />
        </button>
        {auth.profile?.role === 'admin' && (
          <button
            type="button"
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
          type="button"
          className="language-button"
          onClick={() => void i18n.changeLanguage(i18n.language === 'he' ? 'en' : 'he')}
          aria-label={t('language')}
        >
          <Globe />
          {i18n.language === 'he' ? 'EN' : 'עב'}
        </button>
        <button
          type="button"
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
      <Button type="button" variant="secondary" onClick={onRetry}>
        {t('retry')}
      </Button>
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
          <button type="button" onClick={() => void updateServiceWorker(true)}>
            {t('update')}
          </button>
        </motion.aside>
      )}
    </AnimatePresence>
  )
}
