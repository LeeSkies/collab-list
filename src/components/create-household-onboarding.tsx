import { EnvelopeSimple, LockKey, User } from '@phosphor-icons/react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth'
import { api } from '../lib/api'
import { Button } from './ui/button'

type Step = 'welcome' | 'signup' | 'confirmation' | 'trial' | 'complete'

export function CreateHouseholdOnboarding({
  onBack,
  onHouseholdCreated,
  onContinueToList
}: {
  onBack?: () => void
  onHouseholdCreated?: () => void
  onContinueToList?: () => void
}) {
  const { t } = useTranslation()
  const auth = useAuth()
  const [step, setStep] = useState<Step>(auth.session ? 'trial' : 'welcome')
  const [pending, setPending] = useState(false)
  const [continueRequested, setContinueRequested] = useState(false)
  const [error, setError] = useState('')
  const [announcement, setAnnouncement] = useState('')
  const headingRef = useRef<HTMLHeadingElement>(null)
  const visibleStep =
    auth.session && (step === 'confirmation' || step === 'welcome') ? 'trial' : step

  useEffect(() => {
    const heading = headingRef.current
    if (!heading) return
    heading.focus()
    setAnnouncement(heading.textContent ?? '')
  }, [visibleStep])

  useEffect(() => {
    if (continueRequested && step === 'complete' && auth.profile?.household_id) {
      onContinueToList?.()
    }
  }, [auth.profile?.household_id, continueRequested, onContinueToList, step])

  async function submitSignUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const name = String(form.get('name')).trim()
    const email = String(form.get('email')).trim()
    const password = String(form.get('password'))
    setPending(true)
    setError('')
    try {
      const result = await auth.signUp(email, password, name)
      setStep(result.confirmationRequired ? 'confirmation' : 'trial')
    } catch {
      setError(t('createAccountError'))
    } finally {
      setPending(false)
    }
  }

  async function createHousehold() {
    setPending(true)
    setError('')
    try {
      await api.household.create()
      onHouseholdCreated?.()
      setStep('complete')
    } catch (reason) {
      if (reason instanceof Error && reason.message.includes('email_confirmation_required')) {
        setError(t('emailConfirmationRequired'))
      } else if (reason instanceof Error && reason.message.includes('trial_eligibility_consumed')) {
        setError(t('trialEligibilityConsumed'))
      } else {
        setError(t('createHouseholdError'))
      }
    } finally {
      setPending(false)
    }
  }

  async function continueToList() {
    setPending(true)
    setError('')
    try {
      await auth.refreshProfile()
      setContinueRequested(true)
    } catch {
      setError(t('refreshProfileError'))
    } finally {
      setPending(false)
    }
  }

  return (
    <main className="onboarding-page">
      <div className="brand-mark" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </div>
      <section className="onboarding-card">
        <p className="sr-only" aria-live="polite" aria-atomic="true">
          {announcement}
        </p>
        {visibleStep === 'welcome' && (
          <>
            <p className="onboarding-eyebrow">{t('createHousehold')}</p>
            <h1 ref={headingRef} tabIndex={-1}>
              {t('onboardingWelcomeTitle')}
            </h1>
            <p className="onboarding-copy">{t('onboardingWelcomeBody')}</p>
            <ul className="onboarding-points">
              <li>{t('onboardingPointSharedList')}</li>
              <li>{t('onboardingPointAdmin')}</li>
              <li>{t('onboardingPointTrial')}</li>
            </ul>
            <Button size="lg" onClick={() => setStep('signup')}>
              {t('continueToAccount')}
            </Button>
            {onBack && (
              <Button variant="link" onClick={onBack}>
                {t('backToSignIn')}
              </Button>
            )}
          </>
        )}

        {visibleStep === 'signup' && (
          <>
            <p className="onboarding-eyebrow">{t('createHousehold')}</p>
            <h1 ref={headingRef} tabIndex={-1}>
              {t('accountDetailsTitle')}
            </h1>
            <p className="onboarding-copy">{t('accountDetailsBody')}</p>
            <form className="onboarding-form" onSubmit={submitSignUp}>
              <label>
                <span>{t('userName')}</span>
                <span className="input-shell">
                  <User />
                  <input name="name" type="text" autoComplete="name" maxLength={80} required />
                </span>
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
                    minLength={8}
                    required
                  />
                </span>
              </label>
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
              <Button size="lg" type="submit" disabled={pending}>
                {pending ? t('creatingAccount') : t('createAccount')}
              </Button>
            </form>
            <Button variant="link" onClick={() => setStep('welcome')}>
              {t('back')}
            </Button>
          </>
        )}

        {visibleStep === 'confirmation' && (
          <>
            <p className="onboarding-eyebrow">{t('checkYourEmail')}</p>
            <h1 ref={headingRef} tabIndex={-1}>
              {t('confirmEmailTitle')}
            </h1>
            <p className="onboarding-copy">{t('confirmEmailBody')}</p>
            <p className="onboarding-note">{t('confirmEmailReminder')}</p>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
          </>
        )}

        {visibleStep === 'trial' && (
          <>
            <p className="onboarding-eyebrow">{t('oneLastStep')}</p>
            <h1 ref={headingRef} tabIndex={-1}>
              {t('trialConfirmationTitle')}
            </h1>
            <p className="onboarding-copy">{t('trialConfirmationBody')}</p>
            <div className="trial-summary">
              <strong>{t('trialLength')}</strong>
              <span>{t('trialNoPayment')}</span>
              <span>{t('trialAdminNotice')}</span>
            </div>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <Button size="lg" onClick={() => void createHousehold()} disabled={pending}>
              {pending ? t('creatingHousehold') : t('confirmCreateHousehold')}
            </Button>
          </>
        )}

        {visibleStep === 'complete' && (
          <>
            <p className="onboarding-eyebrow">{t('householdCreated')}</p>
            <h1 ref={headingRef} tabIndex={-1}>
              {t('householdCreatedTitle')}
            </h1>
            <p className="onboarding-copy">{t('householdCreatedBody')}</p>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <Button size="lg" onClick={() => void continueToList()} disabled={pending}>
              {pending ? t('continuingToList') : t('continueToList')}
            </Button>
          </>
        )}
      </section>
    </main>
  )
}
