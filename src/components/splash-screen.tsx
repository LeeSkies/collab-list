import { motion, useReducedMotion } from 'motion/react'
import { useTranslation } from 'react-i18next'

/**
 * Keeps the branded handoff visible after the platform launch splash while
 * the session and household profile are restored.
 */
export function SplashScreen() {
  const reduceMotion = useReducedMotion()
  const { t } = useTranslation()
  return (
    <div className="splash-screen" role="status" aria-label={t('loading')}>
      <span className="splash-ring" aria-hidden="true" />
      <motion.div
        className="splash-center"
        initial={reduceMotion ? false : { opacity: 0, scale: 0.82, rotate: -12 }}
        animate={reduceMotion ? undefined : { opacity: 1, scale: 1, rotate: 0 }}
        transition={{ duration: 1.05, ease: 'easeInOut' }}
      >
        <motion.svg
          className="splash-mark"
          data-testid="splash-mark"
          viewBox="0 0 512 512"
          aria-hidden="true"
          animate={reduceMotion ? { opacity: [0.55, 1, 0.55] } : { scale: [1, 1.03, 1] }}
          transition={
            reduceMotion
              ? { duration: 1.6, repeat: Infinity, ease: 'easeInOut' }
              : { duration: 3.8, repeat: Infinity, ease: 'easeInOut' }
          }
        >
          <g fill="#f6f1e7">
            <path d="M256 78c70 50 70 121 0 171-70-50-70-121 0-171Z" />
            <path d="M434 256c-50 70-121 70-171 0 50-70 121-70 171 0Z" />
            <path d="M256 434c-70-50-70-121 0-171 70 50 70 121 0 171Z" />
            <path d="M78 256c50-70 121-70 171 0-50-70-121-70-171 0Z" />
          </g>
          <circle cx="256" cy="256" r="38" fill="#d98b50" />
        </motion.svg>
      </motion.div>
    </div>
  )
}
