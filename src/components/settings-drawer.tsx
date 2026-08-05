import {
  ArrowLeft,
  CaretRight,
  Check,
  Globe,
  SignOut,
  Tag,
  UserCircle,
  UsersThree
} from '@phosphor-icons/react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth'
import { AccountDrawer } from './account-drawer'
import { AdminDrawer } from './admin-drawer'
import { CategoriesSettings } from './category-settings'
import { AppDrawer } from './drawer'

type SettingsView = 'root' | 'language' | 'account' | 'categories' | 'admin'

function noop() {}

function LanguageSettings() {
  const { t, i18n } = useTranslation()
  const options = [
    { code: 'he', label: t('languageOptionHe') },
    { code: 'en', label: t('languageOptionEn') },
    { code: 'ar', label: t('languageOptionAr') },
    { code: 'fr', label: t('languageOptionFr') }
  ]
  return (
    <div className="settings-nav" role="group" aria-label={t('language')}>
      {options.map((option) => {
        const selected = (i18n.resolvedLanguage ?? i18n.language).startsWith(option.code)
        return (
          <button
            key={option.code}
            type="button"
            className="settings-row language-option"
            aria-pressed={selected}
            onClick={() => void i18n.changeLanguage(option.code)}
          >
            <span>{option.label}</span>
            {selected && <Check weight="bold" className="settings-row-check" />}
          </button>
        )
      })}
    </div>
  )
}

export function SettingsDrawer({
  open,
  onOpenChange,
  canMutate,
  pendingRequestCount
}: {
  open: boolean
  onOpenChange(open: boolean): void
  canMutate: boolean
  pendingRequestCount: number
}) {
  const { t, i18n } = useTranslation()
  const auth = useAuth()
  const [view, setView] = useState<SettingsView>('root')
  const [direction, setDirection] = useState(1)
  const reduced = useReducedMotion()
  const isAdmin = auth.profile?.role === 'admin'
  const backRef = useRef<HTMLButtonElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  // Reset to root whenever the hub closes so re-opening always starts fresh.
  const [previousOpen, setPreviousOpen] = useState(open)
  if (previousOpen !== open) {
    setPreviousOpen(open)
    if (!open) {
      setView('root')
      setDirection(-1)
    }
  }

  function navigate(next: SettingsView) {
    setDirection(next === 'root' ? -1 : 1)
    setView(next)
  }

  // Slide direction mirrors under RTL: forward enters from the "next" side of
  // the writing direction, back re-enters from the "previous" side.
  const travel = direction * (i18n.dir() === 'rtl' ? -1 : 1)

  // Function variants resolve with the direction active at transition time.
  // AnimatePresence passes its current `custom` to the exiting panel and the
  // motion.div passes its own to the entering panel, so both panels travel as a
  // physical stack would instead of crossing or ghosting after repeated
  // forward/back navigation or close/reopen.
  const slideVariants = {
    enter: (d: number) => (reduced ? { opacity: 0 } : { opacity: 0, x: d * 24 }),
    center: { opacity: 1, x: 0 },
    exit: (d: number) => (reduced ? { opacity: 0 } : { opacity: 0, x: d * -24 })
  }

  // Focus moves with the view: the back button on sub-views, the nav on root.
  useEffect(() => {
    if (!open) return
    if (view === 'root') rootRef.current?.focus()
    else backRef.current?.focus()
  }, [open, view])

  const title =
    view === 'root'
      ? t('settings')
      : view === 'language'
        ? t('settingsLanguage')
        : view === 'account'
          ? t('settingsAccount')
          : view === 'categories'
            ? t('settingsCategories')
            : t('settingsAdmin')

  return (
    <AppDrawer
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      className="settings-drawer"
      headerAction={
        view !== 'root' ? (
          <button
            ref={backRef}
            type="button"
            className="icon-button settings-back"
            aria-label={t('back')}
            onClick={() => navigate('root')}
          >
            <ArrowLeft weight="bold" />
          </button>
        ) : undefined
      }
    >
      <AnimatePresence custom={travel} initial={false} mode="popLayout">
        <motion.div
          key={view}
          className="settings-view"
          custom={travel}
          variants={slideVariants}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{ type: 'spring', duration: 0.3, bounce: 0 }}
        >
          {view === 'root' && (
            <div className="settings-nav settings-nav-grouped" ref={rootRef} tabIndex={-1}>
              <section className="settings-group" aria-labelledby="settings-personal-title">
                <h2 id="settings-personal-title">{t('settingsPersonal')}</h2>
                <div className="settings-group-list">
                  <button
                    type="button"
                    className="settings-row"
                    onClick={() => navigate('language')}
                  >
                    <Globe />
                    <span>{t('language')}</span>
                    <CaretRight className="settings-row-chevron" weight="bold" />
                  </button>
                  <button
                    type="button"
                    className="settings-row"
                    onClick={() => navigate('account')}
                  >
                    <UserCircle />
                    <span>{t('account')}</span>
                    <CaretRight className="settings-row-chevron" weight="bold" />
                  </button>
                </div>
              </section>
              <section className="settings-group" aria-labelledby="settings-household-title">
                <h2 id="settings-household-title">{t('settingsHousehold')}</h2>
                <div className="settings-group-list">
                  <button
                    type="button"
                    className="settings-row"
                    onClick={() => navigate('categories')}
                  >
                    <Tag />
                    <span>{t('categories')}</span>
                    <CaretRight className="settings-row-chevron" weight="bold" />
                  </button>
                  {isAdmin && (
                    <button
                      type="button"
                      className="settings-row"
                      onClick={() => navigate('admin')}
                    >
                      <UsersThree />
                      <span>{t('settingsAdmin')}</span>
                      {pendingRequestCount > 0 && (
                        <span
                          className="settings-pending-badge"
                          role="status"
                          aria-label={t('pendingRequests')}
                        >
                          {pendingRequestCount}
                        </span>
                      )}
                      <CaretRight className="settings-row-chevron" weight="bold" />
                    </button>
                  )}
                </div>
              </section>
            </div>
          )}
          {view === 'language' && <LanguageSettings />}
          {view === 'account' && (
            <div className="account-settings-view">
              <AccountDrawer embedded open onOpenChange={noop} />
              <button
                type="button"
                className="settings-row sign-out-row"
                onClick={() => void auth.signOut()}
              >
                <SignOut />
                <span>{t('logout')}</span>
              </button>
            </div>
          )}
          {view === 'categories' && <CategoriesSettings canMutate={canMutate} />}
          {view === 'admin' && isAdmin && (
            <AdminDrawer embedded open onOpenChange={noop} canMutate={canMutate} />
          )}
        </motion.div>
      </AnimatePresence>
    </AppDrawer>
  )
}
