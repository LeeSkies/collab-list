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

export function rollbackOptimisticProduct<T>(
  products: readonly T[],
  optimistic: T,
  previous: T
): T[] {
  return products.map((product) => (product === optimistic ? previous : product))
}
