import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth'
import { AccountEmailError, api } from '../lib/api'
import { AppDrawer } from './drawer'
import { Button } from './ui/button'

export function AccountDrawer({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange(open: boolean): void
}) {
  const { t } = useTranslation()
  const auth = useAuth()
  const [email, setEmail] = useState(auth.profile?.email ?? '')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const updateEmail = useMutation({
    mutationFn: api.account.updateEmail,
    onSuccess: ({ email: nextEmail }) => {
      setEmail(nextEmail)
      setError('')
      setNotice(t('accountEmailConfirmationSent', { email: nextEmail }))
    },
    onError: (reason) => {
      setNotice('')
      if (!(reason instanceof AccountEmailError)) {
        setError(t('accountEmailFailed'))
        return
      }
      setError(
        reason.code === 'invalid_email'
          ? t('accountEmailInvalid')
          : reason.code === 'duplicate_email'
            ? t('accountEmailDuplicate')
            : reason.code === 'email_rate_limited'
              ? t('accountEmailRateLimited')
              : t('accountEmailFailed')
      )
    }
  })

  return (
    <AppDrawer open={open} onOpenChange={onOpenChange} title={t('account')}>
      <form
        className="drawer-form account-form"
        onSubmit={(event) => {
          event.preventDefault()
          setError('')
          setNotice('')
          updateEmail.mutate(email)
        }}
      >
        <p>{t('accountEmailBody')}</p>
        <label>
          <span>{t('currentEmail')}</span>
          <input value={auth.profile?.email ?? ''} readOnly aria-label={t('currentEmail')} />
        </label>
        <label>
          <span>{t('newEmail')}</span>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            required
            aria-label={t('newEmail')}
          />
        </label>
        <p className="account-email-hint">{t('accountEmailOldRemains')}</p>
        {notice && (
          <p className="form-success" role="status">
            {notice}
          </p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <Button className="drawer-save" type="submit" disabled={updateEmail.isPending}>
          {updateEmail.isPending ? t('accountEmailSending') : t('accountEmailSend')}
        </Button>
      </form>
    </AppDrawer>
  )
}
