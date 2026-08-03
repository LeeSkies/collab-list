import { ArrowCounterClockwise, Check, Minus, Plus } from '@phosphor-icons/react'
import { motion, useReducedMotion } from 'motion/react'
import { forwardRef, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { quantityCanAdjust } from '../lib/product'
import type { Product } from '../lib/types'
import { useRowGestureArbitration } from './row-gesture-arbitration'

interface ProductRowProps {
  product: Product
  duplicatePulse: boolean
  animateEntrance?: boolean
  animateChanges?: boolean
  onEntranceComplete?(): void
  busy?: boolean
  canMutate?: boolean
  onEdit(): void
  onAdjust(delta: 1 | -1): void
  onToggle(): void
}

export const ProductRow = forwardRef<HTMLLIElement, ProductRowProps>(function ProductRow(
  {
    product,
    duplicatePulse,
    animateEntrance = false,
    animateChanges = true,
    onEntranceComplete,
    busy = false,
    canMutate = true,
    onEdit,
    onAdjust,
    onToggle
  },
  ref
) {
  const { t, i18n } = useTranslation()
  const reduced = useReducedMotion()
  const direction = i18n.dir() === 'rtl' ? 1 : -1
  const [canReflow, setCanReflow] = useState(false)
  const {
    articleProps,
    revealStyle,
    childControlProps,
    reveal: heldDetails
  } = useRowGestureArbitration({
    name: product.name,
    notes: product.notes,
    direction,
    busy,
    canMutate,
    onToggle
  })

  useEffect(() => {
    const frame = requestAnimationFrame(() => setCanReflow(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  return (
    <motion.li
      ref={ref}
      layout={animateChanges && !reduced && canReflow ? 'position' : false}
      layoutId={animateChanges ? `product-${product.id}` : undefined}
      data-product-id={product.id}
      className={`product-wrap ${duplicatePulse ? 'duplicate-pulse' : ''}`}
      initial={animateEntrance ? (reduced ? { opacity: 0 } : { opacity: 0, scale: 0.9 }) : false}
      animate={{ opacity: 1, scale: 1 }}
      exit={animateChanges ? { opacity: 0 } : undefined}
      transition={{ type: 'spring', duration: 0.24, bounce: 0 }}
      onAnimationComplete={animateEntrance ? onEntranceComplete : undefined}
    >
      <motion.div className="swipe-reveal" style={revealStyle}>
        {product.is_picked ? <ArrowCounterClockwise weight="bold" /> : <Check weight="bold" />}
      </motion.div>
      <motion.article
        {...articleProps}
        className={`product-row ${product.is_picked ? 'is-picked' : ''}`}
        animate={duplicatePulse ? { x: [0, -5, 5, -3, 3, 0] } : undefined}
        transition={{ duration: 0.28, ease: [0.2, 0, 0, 1] }}
      >
        <button
          type="button"
          className="product-main"
          onClick={onEdit}
          disabled={busy || !canMutate}
          aria-label={t('edit', { name: product.name })}
        >
          <strong>
            <span className="hold-name">{product.name}</span>
          </strong>
          {product.notes && <span>{product.notes}</span>}
        </button>
        {product.is_picked ? (
          <input
            className="quantity-readonly"
            aria-label={`${t('quantity')}: ${product.quantity}`}
            value={product.quantity}
            readOnly
            onClick={onEdit}
            disabled={!canMutate}
            {...childControlProps}
          />
        ) : (
          <div className="quantity-controls" {...childControlProps}>
            <button
              type="button"
              aria-label={t('minus')}
              disabled={busy || !canMutate || !quantityCanAdjust(product.quantity, -1)}
              onClick={() => onAdjust(-1)}
            >
              <Minus weight="bold" />
            </button>
            <button
              type="button"
              className="quantity-value"
              aria-label={`${t('quantity')}: ${product.quantity}`}
              onClick={onEdit}
              disabled={busy || !canMutate}
            >
              {product.quantity}
            </button>
            <button
              type="button"
              aria-label={t('plus')}
              disabled={busy || !canMutate || !quantityCanAdjust(product.quantity, 1)}
              onClick={() => onAdjust(1)}
            >
              <Plus weight="bold" />
            </button>
          </div>
        )}
        <button type="button" className="sr-only" onClick={onToggle} disabled={busy || !canMutate}>
          {product.is_picked ? t('restore') : t('pick')}
        </button>
      </motion.article>
      {heldDetails}
    </motion.li>
  )
})
