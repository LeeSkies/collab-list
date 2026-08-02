import { Dialog } from '@base-ui/react/dialog'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Role } from '../lib/types'

type TourStep = {
  title: string
  body: string
}

export function ProductTour({ role, onComplete }: { role: Role; onComplete(): Promise<unknown> }) {
  const { t } = useTranslation()
  const isAdmin = role === 'admin'
  const [stepIndex, setStepIndex] = useState(0)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const steps: TourStep[] = [
    { title: t('productTourSearchTitle'), body: t('productTourSearchBody') },
    { title: t('productTourAddTitle'), body: t('productTourAddBody') },
    { title: t('productTourOrganizeTitle'), body: t('productTourOrganizeBody') },
    { title: t('productTourEditTitle'), body: t('productTourEditBody') },
    ...(isAdmin ? [{ title: t('productTourMembersTitle'), body: t('productTourMembersBody') }] : [])
  ]
  const step = steps[stepIndex] ?? steps[0]!
  const isLastStep = stepIndex === steps.length - 1

  async function next() {
    if (!isLastStep) {
      setStepIndex((current) => current + 1)
      return
    }
    if (pending) return
    setPending(true)
    setError('')
    try {
      await onComplete()
    } catch {
      setError(t('productTourError'))
      setPending(false)
    }
  }

  return (
    <Dialog.Root open={true} onOpenChange={() => undefined}>
      <Dialog.Portal>
        <Dialog.Backdrop className="product-tour-backdrop" />
        <Dialog.Viewport className="product-tour-layer">
          <Dialog.Popup className="product-tour-dialog">
            <p className="product-tour-eyebrow">{t('productTourEyebrow')}</p>
            <p className="product-tour-step" aria-live="polite">
              {t('productTourStep', { current: stepIndex + 1, total: steps.length })}
            </p>
            <Dialog.Title>{step.title}</Dialog.Title>
            <Dialog.Description>{step.body}</Dialog.Description>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button
              className="button product-tour-next"
              type="button"
              onClick={() => void next()}
              disabled={pending}
            >
              {t('productTourNext')}
            </button>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
