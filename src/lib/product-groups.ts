import { categoryLabel } from './product-category'
import type { Category } from './types'

export interface ProductSectionGroup<T> {
  key: string
  label: string
  products: T[]
}

/**
 * Builds the presentation grouping for a product list. In category mode the
 * household's categories provide both the membership and the order (sorted by
 * name), empty groups are omitted, and labels resolve through the translation
 * lookup with a stored-name fallback for custom names. In flat mode the list
 * becomes a single unnamed group. Grouping is pure: it knows nothing about
 * Motion, AnimatePresence, or animation modes.
 */
export function buildProductGroups<T extends { category_id: string }>(
  products: T[],
  categories: Category[],
  t: (key: string) => string,
  groupByCategory: boolean
): ProductSectionGroup<T>[] {
  if (!groupByCategory) return [{ key: 'all', label: '', products }]
  return categories
    .map((category) => ({
      key: category.id,
      label: categoryLabel(t, category.name),
      products: products.filter((product) => product.category_id === category.id)
    }))
    .filter((group) => group.products.length > 0)
}
