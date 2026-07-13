import { Dialog } from '@base-ui/react/dialog'
import { X } from '@phosphor-icons/react'
import type { ReactNode } from 'react'

export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  className = ''
}: {
  open: boolean
  onOpenChange(open: boolean): void
  title: string
  description?: string
  children: ReactNode
  className?: string
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="sheet-backdrop" />
        <Dialog.Viewport className="sheet-viewport">
          <Dialog.Popup className={`sheet-popup ${className}`}>
            <header className="sheet-heading">
              <div>
                <Dialog.Title>{title}</Dialog.Title>
                {description && <Dialog.Description>{description}</Dialog.Description>}
              </div>
              <Dialog.Close className="icon-button" aria-label="Close">
                <X />
              </Dialog.Close>
            </header>
            {children}
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  onConfirm,
  destructive = false
}: {
  open: boolean
  onOpenChange(open: boolean): void
  title: string
  body: string
  confirmLabel: string
  onConfirm(): void
  destructive?: boolean
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="sheet-backdrop confirm" />
        <Dialog.Viewport className="confirm-viewport">
          <Dialog.Popup className="confirm-popup">
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Description>{body}</Dialog.Description>
            <div className="confirm-actions">
              <Dialog.Close className="button secondary">Cancel</Dialog.Close>
              <button className={destructive ? 'button danger' : 'button'} onClick={onConfirm}>
                {confirmLabel}
              </button>
            </div>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
