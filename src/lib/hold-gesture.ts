import { useEffect, useRef, useState } from 'react'
import type { MouseEvent, PointerEvent } from 'react'

export const HOLD_DELAY_MS = 360
export const MOVE_TOLERANCE_PX = 10
export const SWIPE_THRESHOLD_PX = 76

export type HoldPhase = 'idle' | 'pending' | 'held'

export interface HoldTargetProps {
  onPointerDown(event: PointerEvent<HTMLElement>): void
  onClickCapture(event: MouseEvent<HTMLElement>): void
  onContextMenu(event: MouseEvent<HTMLElement>): void
}

/**
 * A press has drifted enough that it is no longer a hold. Measured in any
 * direction so diagonal and ambiguous gestures cancel predictably.
 */
export function holdCancelsOnMovement(
  dx: number,
  dy: number,
  tolerance = MOVE_TOLERANCE_PX
): boolean {
  return Math.hypot(dx, dy) > tolerance
}

/**
 * Decides the outcome of a horizontal row drag. A swipe commits to the row
 * action once the offset passes the threshold in the row's swipe direction;
 * anything short of that returns the row to rest.
 */
export function swipeDecision(offsetX: number, direction: 1 | -1): 'toggle' | 'return' {
  return offsetX * direction >= SWIPE_THRESHOLD_PX ? 'toggle' : 'return'
}

/**
 * Owns the pointer lifecycle for a press-and-hold target: hold timing,
 * movement cancellation, pointer-cancel and unmount cleanup, and click
 * suppression after a completed hold. Callers decide what a hold reveals.
 */
export function useHoldGesture(): { phase: HoldPhase; targetProps: HoldTargetProps } {
  const timerRef = useRef(0)
  const cleanupRef = useRef<() => void>(() => undefined)
  const suppressClickRef = useRef(false)
  const [phase, setPhase] = useState<HoldPhase>('idle')

  function stopTracking() {
    window.clearTimeout(timerRef.current)
    cleanupRef.current()
    cleanupRef.current = () => undefined
  }

  function startHold(event: PointerEvent<HTMLElement>) {
    if (event.isPrimary === false || event.button !== 0) return

    stopTracking()
    suppressClickRef.current = false
    const { clientX: startX, clientY: startY, pointerId } = event

    const move = (moveEvent: globalThis.PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return
      if (holdCancelsOnMovement(moveEvent.clientX - startX, moveEvent.clientY - startY)) {
        stopTracking()
        setPhase('idle')
      }
    }
    const end = (endEvent: globalThis.PointerEvent) => {
      if (endEvent.pointerId !== pointerId) return
      stopTracking()
      setPhase('idle')
    }

    window.addEventListener('pointermove', move, true)
    window.addEventListener('pointerup', end, true)
    window.addEventListener('pointercancel', end, true)
    cleanupRef.current = () => {
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('pointerup', end, true)
      window.removeEventListener('pointercancel', end, true)
    }
    setPhase('pending')
    timerRef.current = window.setTimeout(() => {
      suppressClickRef.current = true
      setPhase('held')
    }, HOLD_DELAY_MS)
  }

  useEffect(
    () => () => {
      window.clearTimeout(timerRef.current)
      cleanupRef.current()
    },
    []
  )

  const targetProps: HoldTargetProps = {
    onPointerDown: startHold,
    onClickCapture(event: MouseEvent<HTMLElement>) {
      if (!suppressClickRef.current) return
      event.preventDefault()
      event.stopPropagation()
      suppressClickRef.current = false
    },
    onContextMenu(event: MouseEvent<HTMLElement>) {
      event.preventDefault()
    }
  }

  return { phase, targetProps }
}
