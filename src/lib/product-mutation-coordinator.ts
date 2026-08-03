export type ProductMutationState = {
  productIds: ReadonlySet<string>
  bulk: boolean
}

export class ProductMutationCoordinator {
  readonly #productIds = new Set<string>()
  #bulk = false

  lockProduct(productId: string): boolean {
    if (this.#bulk || this.#productIds.has(productId)) return false
    this.#productIds.add(productId)
    return true
  }

  unlockProduct(productId: string): void {
    this.#productIds.delete(productId)
  }

  lockBulk(): boolean {
    if (this.#bulk || this.#productIds.size > 0) return false
    this.#bulk = true
    return true
  }

  unlockBulk(): void {
    this.#bulk = false
  }

  snapshot(): ProductMutationState {
    return { productIds: new Set(this.#productIds), bulk: this.#bulk }
  }
}

export interface RevisionedProduct {
  id: string
  version: number
}

export function rollbackOptimisticProduct<T extends RevisionedProduct>(
  products: readonly T[],
  optimistic: T,
  previous: T
): T[] {
  return products.map((product) =>
    product.id === optimistic.id && product.version === optimistic.version ? previous : product
  )
}

export function applyAuthoritativeProduct<T extends RevisionedProduct>(
  products: readonly T[],
  authoritative: T
): T[] {
  return products.map((product) =>
    product.id === authoritative.id
      ? product.version > authoritative.version
        ? product
        : authoritative
      : product
  )
}
