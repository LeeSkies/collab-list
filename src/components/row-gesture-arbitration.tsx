import {
  animate,
  useMotionValue,
  useReducedMotion,
  useTransform,
  type MotionValue
} from 'motion/react'
import { useState } from 'react'
import type { MouseEvent, PointerEvent } from 'react'
import { swipeDecision, useHoldGesture } from '../lib/hold-gesture'
import { HoldRevealPortal } from './hold-to-reveal-name'

export interface RowGestureArbitrationOptions {
  name: string
  notes?: string | null
  /** 1 for RTL, -1 for LTR: the direction a committed swipe travels. */
  direction: 1 | -1
  busy: boolean
  canMutate: boolean
  onToggle(): void
}

export interface RowGestureArbitrationResult {
  /**
   * Props for the row's swipe/hold surface. Spreading these onto the
   * interactive article installs hold, swipe, tap suppression, context-menu
   * suppression, and pointer-cancellation handling at one explicit seam.
   */
  articleProps: Record<string, unknown>
  /** Style for the action icon revealed underneath the row while swiping. */
  revealStyle: { opacity: MotionValue<number> }
  /**
   * Props for child controls (quantity buttons, read-only quantity input).
   * These stop pointer and context-menu events from reaching the row seam so
   * child interactions never start a hold or a swipe.
   */
  childControlProps: {
    onPointerDown(event: PointerEvent<HTMLElement>): void
    onContextMenu(event: MouseEvent<HTMLElement>): void
  }
  /** Portal with the held-name tooltip. */
  reveal: ReturnType<typeof HoldRevealPortal>
}

/**
 * Explicit row-gesture arbitration. The row interaction surface has a single
 * owner for hold-to-reveal, swipe, tap, pointer cancellation, context-menu
 * suppression, and child-control exclusion. The screen and the row renderer
 * consume the outcome rather than coordinating pointer ownership themselves.
 */
export function useRowGestureArbitration(
  options: RowGestureArbitrationOptions
): RowGestureArbitrationResult {
  const { name, notes, direction, busy, canMutate, onToggle } = options
  const reducedMotion = useReducedMotion()
  const x = useMotionValue(0)
  const opacity = useMotionValue(1)
  const progress = useTransform(x, [0, direction * 92], [0, 1])
  const backgroundOpacity = useTransform(progress, [0, 1], [0, 1])
  const [crossed, setCrossed] = useState(false)
  const { phase, targetProps: holdTargetProps } = useHoldGesture()

  function settleBack() {
    setCrossed(false)
    void Promise.all([
      animate(x, 0, { type: 'spring', duration: 0.25, bounce: 0 }),
      animate(opacity, 1, { duration: 0.15, ease: [0.2, 0, 0, 1] })
    ])
  }

  function commitSwipe() {
    setCrossed(false)
    void Promise.all([
      animate(x, direction * (window.innerWidth + 120), {
        duration: 0.22,
        ease: [0.2, 0, 0, 1]
      }),
      animate(opacity, 0.12, {
        duration: 0.2,
        ease: [0.2, 0, 0, 1]
      })
    ]).then(onToggle)
  }

  const articleProps = {
    ...holdTargetProps,
    style: { x, opacity },
    drag: reducedMotion || busy || !canMutate ? false : 'x',
    dragConstraints: { left: direction < 0 ? -104 : 0, right: direction > 0 ? 104 : 0 },
    dragElastic: 0.08,
    dragMomentum: false,
    onDrag: (_event: unknown, info: { offset: { x: number } }) =>
      setCrossed(swipeDecision(info.offset.x, direction) === 'toggle'),
    onDragEnd: (_event: unknown, info: { offset: { x: number } }) => {
      if (!canMutate) {
        settleBack()
        return
      }
      if (swipeDecision(info.offset.x, direction) === 'toggle') commitSwipe()
      else settleBack()
    },
    'data-threshold': crossed || undefined
  }

  const childControlProps: RowGestureArbitrationResult['childControlProps'] = {
    onPointerDown: (event) => event.stopPropagation(),
    onContextMenu: (event) => event.stopPropagation()
  }

  return {
    articleProps,
    revealStyle: { opacity: backgroundOpacity },
    childControlProps,
    reveal: <HoldRevealPortal phase={phase} name={name} notes={notes} />
  }
}
