import { Switch } from '@base-ui/react/switch'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChoiceDialog, ConfirmDialog } from './drawer'

export type ResetHouseholdOptions = {
  clearProducts: boolean
  removeMembers: boolean
}

export function ResetHouseholdDialog({
  open,
  onOpenChange,
  onConfirm,
  pending
}: {
  open: boolean
  onOpenChange(open: boolean): void
  onConfirm(options: ResetHouseholdOptions): void
  pending: boolean
}) {
  const { t } = useTranslation()
  const [clearProducts, setClearProducts] = useState(false)
  const [removeMembers, setRemoveMembers] = useState(false)
  const [confirmationOpen, setConfirmationOpen] = useState(false)

  function resetOptions() {
    setClearProducts(false)
    setRemoveMembers(false)
  }

  function changeOpen(nextOpen: boolean) {
    if (!nextOpen && !confirmationOpen) resetOptions()
    onOpenChange(nextOpen)
  }

  function requestConfirmation() {
    setConfirmationOpen(true)
    onOpenChange(false)
  }

  function cancelConfirmation(nextOpen: boolean) {
    if (nextOpen) return
    setConfirmationOpen(false)
    resetOptions()
    onOpenChange(false)
  }

  function confirmReset() {
    const options = { clearProducts, removeMembers }
    setConfirmationOpen(false)
    resetOptions()
    onOpenChange(false)
    onConfirm(options)
  }

  return (
    <>
      <ChoiceDialog
        open={open && !confirmationOpen}
        onOpenChange={changeOpen}
        title={t('resetHouseholdTitle')}
        body={t('resetHouseholdBody')}
        confirmLabel={t('resetHouseholdContinue')}
        confirmDisabled={!clearProducts && !removeMembers}
        pending={pending}
        onConfirm={requestConfirmation}
      >
        <SwitchOption
          checked={clearProducts}
          onCheckedChange={setClearProducts}
          label={t('resetHouseholdProducts')}
        />
        <SwitchOption
          checked={removeMembers}
          onCheckedChange={setRemoveMembers}
          label={t('resetHouseholdMembers')}
        />
      </ChoiceDialog>
      <ConfirmDialog
        open={confirmationOpen}
        onOpenChange={cancelConfirmation}
        title={t('resetHouseholdConfirmTitle')}
        body={t('resetHouseholdConfirmBody')}
        confirmLabel={t('resetHouseholdConfirm')}
        destructive
        pending={pending}
        onConfirm={confirmReset}
      />
    </>
  )
}

function SwitchOption({
  checked,
  onCheckedChange,
  label
}: {
  checked: boolean
  onCheckedChange(checked: boolean): void
  label: string
}) {
  return (
    <label className="switch-option">
      <span>{label}</span>
      <Switch.Root checked={checked} onCheckedChange={onCheckedChange}>
        <Switch.Thumb />
      </Switch.Root>
    </label>
  )
}
