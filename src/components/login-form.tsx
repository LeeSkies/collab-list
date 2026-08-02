import { EnvelopeSimple, LockKey } from '@phosphor-icons/react'
import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth'
import { Button } from './ui/button'

export function inviteConfirmationRedirect(token: string, currentUrl = window.location.href) {
  const url = new URL(currentUrl)
  const base = new URL(import.meta.env.BASE_URL, url.origin).pathname.replace(/\/+$/, '')
  url.pathname = `${base}/invite/${encodeURIComponent(token)}`
  url.search = ''
  url.hash = ''
  return url.toString()
}

export function LoginForm({
  onCreateHousehold,
  showCreateHousehold = true,
  inviteMode = false,
  inviteToken
}: {
  onCreateHousehold?: () => void
  showCreateHousehold?: boolean
  inviteMode?: boolean
  inviteToken?: string
}) {
  const { t } = useTranslation()
  const { signIn, signUp } = useAuth()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [signUpOpen, setSignUpOpen] = useState(false)
  const [confirmationRequired, setConfirmationRequired] = useState(false)

  useEffect(() => {
    if (inviteToken) sessionStorage.setItem('pending-invite-token', inviteToken)
  }, [inviteToken])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setPending(true)
    setError('')
    try {
      await signIn(String(form.get('email')), String(form.get('password')))
    } catch {
      setError(t('loginError'))
    } finally {
      setPending(false)
    }
  }

  async function submitSignUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setPending(true)
    setError('')
    try {
      const redirect = inviteToken ? inviteConfirmationRedirect(inviteToken) : undefined
      const result = await signUp(
        String(form.get('email')),
        String(form.get('password')),
        String(form.get('name')).trim(),
        redirect
      )
      setConfirmationRequired(result.confirmationRequired)
    } catch {
      setError(t('createAccountError'))
    } finally {
      setPending(false)
    }
  }

  return (
    <main className="login-page">
      <div className="brand-mark" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </div>
      <section className="login-card">
        <h1>{t('appName')}</h1>
        <p className="login-welcome">{inviteMode ? t('inviteSignInHint') : t('loginWelcome')}</p>
        {confirmationRequired ? (
          <div className="invite-confirmation">
            <h2>{t('checkYourEmail')}</h2>
            <p className="login-welcome">{t('inviteConfirmationBody')}</p>
          </div>
        ) : signUpOpen ? (
          <form onSubmit={submitSignUp}>
            <label>
              <span>{t('userName')}</span>
              <input name="name" type="text" autoComplete="name" maxLength={80} required />
            </label>
            <label>
              <span>{t('email')}</span>
              <span className="input-shell">
                <EnvelopeSimple />
                <input name="email" type="email" autoComplete="email" required />
              </span>
            </label>
            <label>
              <span>{t('password')}</span>
              <span className="input-shell">
                <LockKey />
                <input
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                />
              </span>
            </label>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <Button size="lg" disabled={pending} type="submit">
              {pending ? t('creatingAccount') : t('createAccount')}
            </Button>
            <Button type="button" variant="link" onClick={() => setSignUpOpen(false)}>
              {t('backToSignIn')}
            </Button>
          </form>
        ) : (
          <form onSubmit={submit}>
            <label>
              <span>{t('email')}</span>
              <span className="input-shell">
                <EnvelopeSimple />
                <input name="email" type="email" autoComplete="email" required autoFocus />
              </span>
            </label>
            <label>
              <span>{t('password')}</span>
              <span className="input-shell">
                <LockKey />
                <input
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  minLength={6}
                />
              </span>
            </label>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <Button size="lg" disabled={pending} type="submit">
              {pending ? t('signingIn') : t('login')}
            </Button>
          </form>
        )}
        {inviteMode && !signUpOpen && !confirmationRequired && (
          <Button
            className="login-create"
            size="lg"
            variant="secondary"
            onClick={() => {
              setError('')
              setSignUpOpen(true)
            }}
          >
            {t('inviteCreateAccount')}
          </Button>
        )}
        {showCreateHousehold && onCreateHousehold && (
          <Button
            className="login-create"
            size="lg"
            variant="secondary"
            onClick={onCreateHousehold}
          >
            {t('createHousehold')}
          </Button>
        )}
      </section>
    </main>
  )
}
