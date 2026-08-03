import { PRODUCT_CATEGORIES, type ProductCategory } from './product-category'

export type ProductGroupKey = 'all' | ProductCategory

export interface ProductSectionGroup<T> {
  key: ProductGroupKey
  label: string
  products: T[]
}

export type CategoryLabelLookup = (key: string) => string

/**
 * Builds the presentation grouping for a product list. In category mode the
 * taxonomy and fixed order come from PRODUCT_CATEGORIES, empty groups are
 * omitted, and labels are resolved through the translation lookup. In flat
 * mode the list becomes a single unnamed group. Grouping is pure: it knows
 * nothing about Motion, AnimatePresence, or animation modes.
 */
export function buildProductGroups<T extends { category: ProductCategory }>(
  products: T[],
  t: CategoryLabelLookup,
  groupByCategory: boolean
): ProductSectionGroup<T>[] {
  if (!groupByCategory) return [{ key: 'all', label: '', products }]
  return PRODUCT_CATEGORIES.map((category) => ({
    key: category,
    label: t(`category_${category}`),
    products: products.filter((product) => product.category === category)
  })).filter((group) => group.products.length > 0)
}
