import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'

const HOLD_DELAY = 360
const MOVE_TOLERANCE = 10

export function HoldToRevealName({ name, children }: { name: string; children?: ReactNode }) {
  const textRef = useRef<HTMLSpanElement>(null)
  const timerRef = useRef<number>(0)
  const cleanupRef = useRef<() => void>(() => undefined)
  const suppressClickRef = useRef(false)
  const [revealed, setRevealed] = useState(false)
  const reducedMotion = useReducedMotion()

  function stopTracking() {
    window.clearTimeout(timerRef.current)
    cleanupRef.current()
    cleanupRef.current = () => undefined
  }

  function startHold(event: PointerEvent<HTMLSpanElement>) {
    if (event.isPrimary === false || event.button !== 0) return
    const element = textRef.current
    if (!element || element.scrollWidth <= element.clientWidth + 1) return

    stopTracking()
    suppressClickRef.current = false
    const { clientX: startX, clientY: startY, pointerId } = event

    const move = (moveEvent: globalThis.PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return
      if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) > MOVE_TOLERANCE) {
        stopTracking()
        setRevealed(false)
      }
    }
    const end = (endEvent: globalThis.PointerEvent) => {
      if (endEvent.pointerId !== pointerId) return
      stopTracking()
      setRevealed(false)
    }

    window.addEventListener('pointermove', move, true)
    window.addEventListener('pointerup', end, true)
    window.addEventListener('pointercancel', end, true)
    cleanupRef.current = () => {
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('pointerup', end, true)
      window.removeEventListener('pointercancel', end, true)
    }
    timerRef.current = window.setTimeout(() => {
      suppressClickRef.current = true
      setRevealed(true)
    }, HOLD_DELAY)
  }

  useEffect(
    () => () => {
      window.clearTimeout(timerRef.current)
      cleanupRef.current()
    },
    []
  )

  return (
    <>
      <span
        ref={textRef}
        className="hold-name"
        onPointerDown={startHold}
        onClickCapture={(event) => {
          if (!suppressClickRef.current) return
          event.preventDefault()
          event.stopPropagation()
          suppressClickRef.current = false
        }}
        onContextMenu={(event) => event.preventDefault()}
      >
        {children ?? name}
      </span>
      {createPortal(
        <AnimatePresence>
          {revealed && (
            <motion.div
              key="held-name"
              className="held-name-reveal"
              role="tooltip"
              initial={reducedMotion ? false : { opacity: 0, y: -6, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.98 }}
              transition={{ type: 'spring', duration: 0.3, bounce: 0 }}
            >
              {name}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  )
}
