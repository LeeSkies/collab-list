import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { buildProductGroups } from '../lib/product-groups'
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
  canMutate = true,
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
  canMutate?: boolean
  onEdit(product: Product): void
  onAdjust(product: Product, delta: 1 | -1): void
  onToggle(product: Product): void
  showCount?: boolean
  headerAction?: ReactNode
  groupByCategory?: boolean
  animateChanges?: boolean
}) {
  const { t } = useTranslation()
  const groups = buildProductGroups(products, t, groupByCategory)

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
                  canMutate={canMutate}
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
