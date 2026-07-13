import { motion, useReducedMotion } from 'motion/react'
import { useTranslation } from 'react-i18next'

export function LeafLoader({ compact = false }: { compact?: boolean }) {
  const reduceMotion = useReducedMotion()
  const { t } = useTranslation()
  return (
    <div
      className={compact ? 'leaf-loader compact' : 'leaf-loader'}
      role="status"
      aria-label={t('loading')}
    >
      <motion.svg
        viewBox="0 0 52 52"
        aria-hidden="true"
        animate={reduceMotion ? { opacity: [0.55, 1, 0.55] } : { rotate: 360 }}
        transition={{
          duration: reduceMotion ? 1.5 : 1.15,
          repeat: Infinity,
          ease: reduceMotion ? 'easeInOut' : 'linear'
        }}
      >
        {[0, 90, 180, 270].map((rotation, index) => (
          <motion.path
            key={rotation}
            d="M26 5c7 5 7 12 0 17-7-5-7-12 0-17Z"
            transform={`rotate(${rotation} 26 26)`}
            animate={
              reduceMotion ? undefined : { opacity: [0.28, 1, 0.28], scale: [0.78, 1, 0.78] }
            }
            transition={{
              duration: 1.15,
              repeat: Infinity,
              delay: index * 0.14,
              ease: 'easeInOut'
            }}
          />
        ))}
        <circle cx="26" cy="26" r="5" />
      </motion.svg>
      {!compact && <span>{t('loading')}</span>}
    </div>
  )
}
