import { Switch } from '@base-ui/react/switch'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChoiceDialog } from './drawer'

export type RestoreAllOptions = {
  clearNotes: boolean
  resetQuantities: boolean
}

export function RestoreAllDialog({
  open,
  onOpenChange,
  onConfirm,
  pending,
  canMutate = true
}: {
  open: boolean
  onOpenChange(open: boolean): void
  onConfirm(options: RestoreAllOptions): void
  pending: boolean
  canMutate?: boolean
}) {
  const { t } = useTranslation()
  const [clearNotes, setClearNotes] = useState(false)
  const [resetQuantities, setResetQuantities] = useState(false)

  function changeOpen(nextOpen: boolean) {
    if (!nextOpen) {
      setClearNotes(false)
      setResetQuantities(false)
    }
    onOpenChange(nextOpen)
  }

  return (
    <ChoiceDialog
      open={open}
      onOpenChange={changeOpen}
      title={t('restoreAllTitle')}
      body={t('restoreAllBody')}
      confirmLabel={t('confirm')}
      pending={pending || !canMutate}
      confirmDisabled={!canMutate}
      onConfirm={() => {
        if (canMutate) onConfirm({ clearNotes, resetQuantities })
      }}
    >
      <SwitchOption
        checked={clearNotes}
        onCheckedChange={setClearNotes}
        label={t('clearNotes')}
        disabled={!canMutate}
      />
      <SwitchOption
        checked={resetQuantities}
        onCheckedChange={setResetQuantities}
        label={t('resetQuantities')}
        disabled={!canMutate}
      />
    </ChoiceDialog>
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
