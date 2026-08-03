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
  pending,
  canMutate = true
}: {
  open: boolean
  onOpenChange(open: boolean): void
  onConfirm(options: ResetHouseholdOptions): void
  pending: boolean
  canMutate?: boolean
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
        confirmDisabled={!canMutate || (!clearProducts && !removeMembers)}
        pending={pending || !canMutate}
        onConfirm={requestConfirmation}
      >
        <SwitchOption
          checked={clearProducts}
          onCheckedChange={setClearProducts}
          label={t('resetHouseholdProducts')}
          disabled={!canMutate}
        />
        <SwitchOption
          checked={removeMembers}
          onCheckedChange={setRemoveMembers}
          label={t('resetHouseholdMembers')}
          disabled={!canMutate}
        />
      </ChoiceDialog>
      <ConfirmDialog
        open={confirmationOpen}
        onOpenChange={cancelConfirmation}
        title={t('resetHouseholdConfirmTitle')}
        body={t('resetHouseholdConfirmBody')}
        confirmLabel={t('resetHouseholdConfirm')}
        destructive
        pending={pending || !canMutate}
        onConfirm={() => {
          if (canMutate) confirmReset()
        }}
      />
    </>
  )
}

function SwitchOption({
  checked,
  onCheckedChange,
  label,
  disabled = false
}: {
  checked: boolean
  onCheckedChange(checked: boolean): void
  label: string
  disabled?: boolean
}) {
  return (
    <label className="switch-option">
      <span>{label}</span>
      <Switch.Root checked={checked} onCheckedChange={onCheckedChange} disabled={disabled}>
        <Switch.Thumb />
      </Switch.Root>
    </label>
  )
}
