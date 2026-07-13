import { Dialog } from '@base-ui/react/dialog'
import { Drawer } from '@base-ui/react/drawer'
import { X } from '@phosphor-icons/react'
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

export function AppDrawer({
  open,
  onOpenChange,
  title,
  description,
  children,
  headerAction,
  footer,
  nested,
  className = ''
}: {
  open: boolean
  onOpenChange(open: boolean): void
  title: string
  description?: string
  children: ReactNode
  headerAction?: ReactNode
  footer?: ReactNode
  nested?: ReactNode
  className?: string
}) {
  const { t } = useTranslation()
  const viewportOffsetTop = useKeyboardViewportOffsetTop(open)
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange} swipeDirection="down">
      <Drawer.VirtualKeyboardProvider>
        <Drawer.Portal>
          <Drawer.Backdrop className="drawer-backdrop" />
          <Drawer.Viewport
            className="drawer-viewport"
            style={{ '--drawer-viewport-offset-top': `${viewportOffsetTop}px` } as CSSProperties}
          >
            <Drawer.Popup className={`drawer-popup ${className}`}>
              <header className="drawer-heading">
                <span className="drawer-handle" aria-hidden="true" />
                <div className="drawer-heading-row">
                  <div>
                    <Drawer.Title>{title}</Drawer.Title>
                    {description && <Drawer.Description>{description}</Drawer.Description>}
                  </div>
                  <div className="drawer-heading-actions">
                    {headerAction}
                    <Drawer.Close className="icon-button" aria-label={t('close')}>
                      <X />
                    </Drawer.Close>
                  </div>
                </div>
              </header>
              <Drawer.Content className="drawer-content">{children}</Drawer.Content>
              {footer && <footer className="drawer-footer">{footer}</footer>}
            </Drawer.Popup>
          </Drawer.Viewport>
        </Drawer.Portal>
      </Drawer.VirtualKeyboardProvider>
      {nested}
    </Drawer.Root>
  )
}

function useKeyboardViewportOffsetTop(open: boolean) {
  const [offsetTop, setOffsetTop] = useState(0)

  useEffect(() => {
    const viewport = window.visualViewport
    if (!open || !viewport) {
      return
    }

    let frame = 0
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const keyboardOpen = window.innerHeight - viewport.height > 60
        const toolbarOffset = keyboardOpen ? getBraveBottomToolbarOffset() : 0
        setOffsetTop(keyboardOpen ? Math.max(0, Math.ceil(viewport.offsetTop + toolbarOffset)) : 0)
      })
    }

    update()
    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)
    return () => {
      cancelAnimationFrame(frame)
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
    }
  }, [open])

  return open ? offsetTop : 0
}

function getBraveBottomToolbarOffset() {
  const browserNavigator = navigator as Navigator & {
    brave?: unknown
    userAgentData?: { brands?: { brand: string }[] }
  }
  const isAndroid = /Android/i.test(browserNavigator.userAgent)
  const isBrowserTab = window.matchMedia('(display-mode: browser)').matches
  const isBrave =
    Boolean(browserNavigator.brave) ||
    browserNavigator.userAgentData?.brands?.some(({ brand }) => brand === 'Brave')

  // Brave on Android hides its 48px bottom toolbar for the keyboard but, on some
  // devices, leaves that toolbar subtracted from visualViewport.height. Compensate
  // for the stale geometry so the drawer footer meets the real keyboard edge.
  return isAndroid && isBrowserTab && isBrave ? 48 : 0
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
  const { t } = useTranslation()
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="dialog-backdrop" />
        <Dialog.Viewport className="confirm-viewport">
          <Dialog.Popup className="confirm-popup">
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Description>{body}</Dialog.Description>
            <div className="confirm-actions">
              <Dialog.Close className="button secondary">{t('cancel')}</Dialog.Close>
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
