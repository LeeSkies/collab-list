import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { api, ApiError, isProductConflict } from '../lib/api'
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
import type { Product, ProductChanges } from '../lib/types'
import { TrailingRefresh } from '../lib/trailing-refresh'

export interface GroceryListConfig {
  householdId: string | undefined
  canMutate: boolean
  boundaryIsPaid: boolean
  paidBoundaryNeedsAttention: boolean
  search: string
  sortMode: ProductSortMode
  categoryFilters: ReadonlySet<string>
  locale: string
  t: (key: string, variables?: Record<string, unknown>) => string
  /** Stable product id of the product the drawer currently edits, if any. */
  selectedId: string | null
  /** View-state callbacks the screen owns; orchestration reports outcomes. */
  onSelectedChange(product: Product | null): void
  onEntranceAdded(productId: string): void
  onDuplicatePulse(productId: string): void
  onCreated(): void
  onRestoreAllClosed(): void
  /** Refetch the entitlement boundary queries the screen owns. */
  onRefreshEntitlement(): void
  /** Set the screen-owned toast message (product feedback). */
  onToast(message: string): void
}

export function useGroceryList({
  householdId,
  canMutate,
  boundaryIsPaid,
  paidBoundaryNeedsAttention,
  search,
  sortMode,
  categoryFilters,
  locale,
  t,
  selectedId,
  onSelectedChange,
  onEntranceAdded,
  onDuplicatePulse,
  onCreated,
  onRestoreAllClosed,
  onRefreshEntitlement,
  onToast
}: GroceryListConfig) {
  const client = useQueryClient()
  const selectedIdRef = useRef(selectedId)
  useEffect(() => {
    selectedIdRef.current = selectedId
  }, [selectedId])
  const [online, setOnline] = useState(navigator.onLine)
  const [realtime, setRealtime] = useState('connecting')
  const [showConnectionWarning, setShowConnectionWarning] = useState(false)
  const mutationCoordinator = useRef(new ProductMutationCoordinator())
  const previousHouseholdId = useRef<string | undefined>(householdId)
  const [mutationState, setMutationState] = useState<ProductMutationState>({
    productIds: new Set(),
    bulk: false
  })
  const productsQueryKey = useMemo(() => ['products', householdId] as const, [householdId])
  const categoriesQueryKey = useMemo(() => ['categories', householdId] as const, [householdId])

  const products = useQuery({
    queryKey: productsQueryKey,
    queryFn: ({ signal }) => api.products.list(signal),
    enabled: Boolean(householdId),
    retry: 1,
    staleTime: 0,
    gcTime: 0
  })

  // Household categories are immutable in this phase: seed them once and keep
  // them cached so grouping, filtering, and drawer options never flicker.
  const categories = useQuery({
    queryKey: categoriesQueryKey,
    queryFn: ({ signal }) => api.categories.list(signal),
    enabled: Boolean(householdId),
    retry: 1,
    staleTime: Infinity,
    gcTime: Infinity
  })

  // Query lifecycle: drop product caches when the household changes or leaves.
  useEffect(() => {
    const previous = previousHouseholdId.current
    if (!householdId) {
      client.removeQueries({ queryKey: ['products'] })
      client.removeQueries({ queryKey: ['categories'] })
    }
    if (previous !== householdId) {
      if (previous) {
        client.removeQueries({ queryKey: ['products', previous], exact: true })
        client.removeQueries({ queryKey: ['categories', previous], exact: true })
      }
      previousHouseholdId.current = householdId
    }
  }, [client, householdId])

  // Realtime reconciliation: product changes flow through a trailing
  // server-authoritative refetch so echoes cannot double-apply optimistically.
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

  // Reconnect: bring the product list and the screen-owned entitlement state
  // back in sync when the connection returns.
  useEffect(() => {
    const handleOnline = () => {
      setOnline(true)
      onToast(t('connected'))
      if (householdId) {
        void client.refetchQueries({ queryKey: productsQueryKey, type: 'active' })
        onRefreshEntitlement()
      }
    }
    const handleOffline = () => setOnline(false)
    addEventListener('online', handleOnline)
    addEventListener('offline', handleOffline)
    return () => {
      removeEventListener('online', handleOnline)
      removeEventListener('offline', handleOffline)
    }
  }, [client, householdId, onRefreshEntitlement, onToast, productsQueryKey, t])

  const connectionWarningEligible =
    !products.isLoading && !products.isError && (!online || realtime === 'disconnected')

  useEffect(() => {
    const timeout = window.setTimeout(
      () => setShowConnectionWarning(connectionWarningEligible),
      connectionWarningEligible ? 1800 : 0
    )
    return () => window.clearTimeout(timeout)
  }, [connectionWarningEligible])

  // -- derived product-list state --------------------------------------------
  const list = useMemo(() => products.data ?? [], [products.data])
  const householdCategories = useMemo(() => categories.data ?? [], [categories.data])
  const categoryNameById = useMemo(() => {
    const names = new Map<string, string>()
    for (const category of householdCategories) names.set(category.id, category.name)
    return (categoryId: string) => names.get(categoryId)
  }, [householdCategories])
  const categoryFilterActive =
    categoryFilters.size > 0 && categoryFilters.size < householdCategories.length
  const filteredList = useMemo(
    () =>
      categoryFilterActive
        ? list.filter((product) => categoryFilters.has(product.category_id))
        : list,
    [categoryFilterActive, categoryFilters, list]
  )
  const { unpicked, picked } = useMemo(
    () => orderProductSections(filteredList, search, sortMode, locale, categoryNameById),
    [categoryNameById, filteredList, locale, search, sortMode]
  )
  const signature = duplicateSignature(search)
  const duplicate = signature
    ? list.find((product) => product.name_signature === signature)
    : undefined
  const canCreate = canMutate && Boolean(householdId && normalizeText(search)) && !duplicate

  // -- reconciliation primitives ---------------------------------------------
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

  async function refreshProducts(productId?: string) {
    try {
      await client.refetchQueries(
        { queryKey: productsQueryKey, type: 'active' },
        { throwOnError: true }
      )
    } catch {
      if (productId && selectedIdRef.current === productId) onSelectedChange(null)
      return false
    }
    if (!productId) return true
    const latest = client
      .getQueryData<Product[]>(productsQueryKey)
      ?.find((product) => product.id === productId)
    if (selectedIdRef.current === productId) onSelectedChange(latest ?? null)
    return true
  }

  async function mutationError(reason: unknown, productId?: string) {
    const entitlementBoundaryError =
      reason instanceof ApiError &&
      (reason.message.includes('household_read_only') ||
        reason.message.includes('household_entitlement_locked'))
    const paidBoundary = boundaryIsPaid
    const paidAttention = paidBoundaryNeedsAttention
    if (entitlementBoundaryError && householdId) onRefreshEntitlement()
    onToast(
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

  // -- mutation commands ------------------------------------------------------
  const create = useMutation({
    mutationFn: api.products.create,
    onSuccess: (product) => {
      if (!householdId || product.household_id !== householdId) return
      onEntranceAdded(product.id)
      client.setQueryData<Product[]>(productsQueryKey, (current = []) => [
        product,
        ...current.filter((item) => item.id !== product.id)
      ])
      onCreated()
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
      if (
        householdId &&
        selectedIdRef.current === applied.id &&
        applied.household_id === householdId
      )
        onSelectedChange(applied)
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
      if (householdId && selectedIdRef.current === next.id && applied.household_id === householdId)
        onSelectedChange(applied)
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
      if (householdId && applied.household_id === householdId) onSelectedChange(applied)
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
      onRestoreAllClosed()
    },
    onError: (reason) => mutationError(reason)
  })

  function activateCreate() {
    if (!canMutate) return
    if (duplicate) {
      onDuplicatePulse(duplicate.id)
      onToast(t('duplicate'))
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

  return {
    products,
    categories: householdCategories,
    list,
    unpicked,
    picked,
    duplicate,
    canCreate,
    categoryFilterActive,
    mutationState,
    online,
    realtime,
    showConnectionWarning,
    connectionWarningEligible,
    activateCreate,
    adjustProduct,
    toggleProduct,
    saveProduct,
    deleteProduct,
    restoreAllProducts
  }
}
