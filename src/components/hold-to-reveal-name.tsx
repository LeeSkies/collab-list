import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import type { ReactNode } from 'react'
import { useHoldGesture, type HoldPhase } from '../lib/hold-gesture'

/**
 * Portal presentation for a held name. The reveal animation is owned here so
 * every hold surface (product row, drawer title) renders the same tooltip.
 */
export function HoldRevealPortal({
  phase,
  name,
  notes
}: {
  phase: HoldPhase
  name: string
  notes?: string | null
}) {
  const reducedMotion = useReducedMotion()
  return createPortal(
    <AnimatePresence>
      {phase === 'held' && (
        <motion.div
          key="held-name"
          className="held-name-reveal"
          role="tooltip"
          initial={reducedMotion ? false : { opacity: 0, y: -6, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.98 }}
          transition={{ type: 'spring', duration: 0.3, bounce: 0 }}
        >
          <strong>{name}</strong>
          {notes && <span>{notes}</span>}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  )
}

export function useHoldToReveal(name: string, notes?: string | null) {
  const { phase, targetProps } = useHoldGesture()
  return { targetProps, reveal: <HoldRevealPortal phase={phase} name={name} notes={notes} /> }
}

export function HoldToRevealName({
  name,
  notes,
  children
}: {
  name: string
  notes?: string | null
  children?: ReactNode
}) {
  const { targetProps, reveal } = useHoldToReveal(name, notes)
  return (
    <>
      <span className="hold-name" {...targetProps}>
        {children ?? name}
      </span>
      {reveal}
    </>
  )
}
