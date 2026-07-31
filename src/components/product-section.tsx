import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { PRODUCT_CATEGORIES } from '../lib/product-category'
import type { Product } from '../lib/types'
import { ProductRow } from './product-row'

export function ProductSection({
  title,
  products,
  duplicatePulse,
  enteringProductIds,
  onEntranceComplete,
  busyProductIds,
  bulkBusy = false,
  onEdit,
  onAdjust,
  onToggle,
  showCount = true,
  headerAction,
  groupByCategory = false,
  animateChanges = true
}: {
  title: string
  products: Product[]
  duplicatePulse: string
  enteringProductIds?: ReadonlySet<string>
  onEntranceComplete?(productId: string): void
  busyProductIds?: ReadonlySet<string>
  bulkBusy?: boolean
  onEdit(product: Product): void
  onAdjust(product: Product, delta: 1 | -1): void
  onToggle(product: Product): void
  showCount?: boolean
  headerAction?: ReactNode
  groupByCategory?: boolean
  animateChanges?: boolean
}) {
  const { t } = useTranslation()
  const groups = groupByCategory
    ? PRODUCT_CATEGORIES.map((category) => ({
        key: category,
        label: t(`category_${category}`),
        products: products.filter((product) => product.category === category)
      })).filter((group) => group.products.length > 0)
    : [{ key: 'all', label: '', products }]

  return (
    <section className="product-section">
      {title && (
        <h2>
          <span className="section-heading-text">{title}</span>
          {showCount && <span className="section-count">{products.length}</span>}
          {headerAction}
        </h2>
      )}
      {groups.map((group) => (
        <div className="category-group" key={group.key}>
          {group.label && <h3>{group.label}</h3>}
          <motion.ul layout={animateChanges}>
            <AnimatePresence initial={false} mode={animateChanges ? 'popLayout' : 'sync'}>
              {group.products.map((product) => (
                <ProductRow
                  key={product.id}
                  product={product}
                  duplicatePulse={duplicatePulse === product.id}
                  animateEntrance={enteringProductIds?.has(product.id)}
                  animateChanges={animateChanges}
                  onEntranceComplete={() => onEntranceComplete?.(product.id)}
                  busy={bulkBusy || busyProductIds?.has(product.id)}
                  onEdit={() => onEdit(product)}
                  onAdjust={(delta) => onAdjust(product, delta)}
                  onToggle={() => onToggle(product)}
                />
              ))}
            </AnimatePresence>
          </motion.ul>
        </div>
      ))}
    </section>
  )
}
