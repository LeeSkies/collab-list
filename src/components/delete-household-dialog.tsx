import { Dialog } from '@base-ui/react/dialog'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from './ui/button'

export function DeleteHouseholdDialog({
  open,
  onOpenChange,
  pending,
  onConfirm
}: {
  open: boolean
  onOpenChange(open: boolean): void
  pending: boolean
  onConfirm(purgeNow: boolean): void
}) {
  const { t } = useTranslation()
  const [purgeNow, setPurgeNow] = useState(false)
  const [confirmation, setConfirmation] = useState('')
  const canConfirm = confirmation === t('deleteHouseholdConfirmationWord')
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="dialog-backdrop" />
        <Dialog.Viewport className="confirm-viewport">
          <Dialog.Popup className="confirm-popup">
            <Dialog.Title>{t('deleteHouseholdTitle')}</Dialog.Title>
            <Dialog.Description>
              {purgeNow ? t('deleteHouseholdPurgeBody') : t('deleteHouseholdBody')}
            </Dialog.Description>
            <fieldset className="choice-dialog-options">
              <legend>{t('deleteHouseholdMode')}</legend>
              <label>
                <input
                  type="radio"
                  name="household-delete-mode"
                  checked={!purgeNow}
                  onChange={() => setPurgeNow(false)}
                />
                {t('deleteHouseholdRecoverable')}
              </label>
              <label>
                <input
                  type="radio"
                  name="household-delete-mode"
                  checked={purgeNow}
                  onChange={() => setPurgeNow(true)}
                />
                {t('deleteHouseholdPermanent')}
              </label>
            </fieldset>
            <label>
              {t('deleteHouseholdConfirmationLabel')}
              <input
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                autoComplete="off"
              />
            </label>
            <div className="confirm-actions">
              <Dialog.Close className="button secondary" disabled={pending}>
                {t('cancel')}
              </Dialog.Close>
              <Button
                type="button"
                variant="destructive"
                disabled={!canConfirm || pending}
                onClick={() => onConfirm(purgeNow)}
              >
                {purgeNow ? t('deleteHouseholdPermanentAction') : t('deleteHouseholdAction')}
              </Button>
            </div>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
