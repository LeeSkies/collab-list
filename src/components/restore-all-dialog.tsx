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
  pending
}: {
  open: boolean
  onOpenChange(open: boolean): void
  onConfirm(options: RestoreAllOptions): void
  pending: boolean
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
      pending={pending}
      onConfirm={() => onConfirm({ clearNotes, resetQuantities })}
    >
      <SwitchOption checked={clearNotes} onCheckedChange={setClearNotes} label={t('clearNotes')} />
      <SwitchOption
        checked={resetQuantities}
        onCheckedChange={setResetQuantities}
        label={t('resetQuantities')}
      />
    </ChoiceDialog>
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
