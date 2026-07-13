import { EnvelopeSimple, LockKey } from '@phosphor-icons/react'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth'
import { Button } from './ui/button'

export function LoginForm() {
  const { t } = useTranslation()
  const { signIn } = useAuth()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

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

  return (
    <main className="login-page">
      <div className="brand-mark" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </div>
      <section className="login-card">
        <p className="kicker">{t('tagline')}</p>
        <h1>{t('appName')}</h1>
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
      </section>
    </main>
  )
}
