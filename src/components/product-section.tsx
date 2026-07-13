import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'
import type { Product } from '../lib/types'
import { ProductRow } from './product-row'

export function ProductSection({
  title,
  products,
  duplicatePulse,
  onEdit,
  onAdjust,
  onToggle,
  showCount = true,
  headerAction
}: {
  title: string
  products: Product[]
  duplicatePulse: string
  onEdit(product: Product): void
  onAdjust(product: Product, delta: 1 | -1): void
  onToggle(product: Product): void
  showCount?: boolean
  headerAction?: ReactNode
}) {
  return (
    <section className="product-section">
      {title && (
        <h2>
          <span className="section-heading-text">{title}</span>
          {showCount && <span className="section-count">{products.length}</span>}
          {headerAction}
        </h2>
      )}
      <motion.ul layout>
        <AnimatePresence initial={false} mode="popLayout">
          {products.map((product) => (
            <ProductRow
              key={product.id}
              product={product}
              duplicatePulse={duplicatePulse === product.id}
              onEdit={() => onEdit(product)}
              onAdjust={(delta) => onAdjust(product, delta)}
              onToggle={() => onToggle(product)}
            />
          ))}
        </AnimatePresence>
      </motion.ul>
    </section>
  )
}
