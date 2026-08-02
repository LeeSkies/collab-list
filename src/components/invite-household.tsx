import { CheckCircle, Clock, WarningCircle } from '@phosphor-icons/react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth'
import { api, isApiErrorCode } from '../lib/api'
import { supabase } from '../lib/supabase'
import type { HouseholdInvitePreview, HouseholdRequestState } from '../lib/types'
import { Button } from './ui/button'

export function InviteHousehold({ token }: { token: string }) {
  const { t } = useTranslation()
  const auth = useAuth()
  const preview = useQuery<HouseholdInvitePreview>({
    queryKey: ['invite-preview', token],
    queryFn: () => api.household.previewInvite(token),
    retry: false
  })
  const request = useQuery<HouseholdRequestState>({
    queryKey: ['invite-request', token, auth.user?.id],
    queryFn: () => api.household.requestStatus(token),
    enabled: Boolean(auth.session && auth.profile && !auth.profile.household_id),
    retry: false
  })

  useEffect(() => {
    sessionStorage.setItem('pending-invite-token', token)
    return () => {
      // Keep the token through an email-confirmation redirect. It is removed
      // only after approval or an explicit sign-out.
    }
  }, [token])

  useEffect(() => {
    if (!auth.user || !auth.profile || auth.profile.household_id) return
    const channel = supabase
      .channel(`household-join-request:${auth.user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'household_join_requests',
          filter: `user_id=eq.${auth.user.id}`
        },
        () => void request.refetch()
      )
      .subscribe()
    return () => {
      void channel.unsubscribe()
    }
  }, [auth.profile, auth.user, request])

  if (auth.restoring || (auth.session && !auth.profile)) {
    return <main className="loading-page">{t('loading')}</main>
  }
  if (auth.profile?.household_id) {
    // The route keeps the invite token in place while AuthProvider receives
    // the membership Realtime event. The router-level caller renders the list.
    return null
  }

  return (
    <main className="invite-page">
      <InvitePreview preview={preview.data} error={preview.error} />
      {auth.session && auth.profile ? (
        <InviteRequestPanel
          token={token}
          preview={preview.data}
          request={request.data}
          requestLoading={request.isLoading}
          onRequested={() => void request.refetch()}
        />
      ) : null}
    </main>
  )
}

function InvitePreview({
  preview,
  error
}: {
  preview: HouseholdInvitePreview | undefined
  error: Error | null
}) {
  const { t } = useTranslation()
  return (
    <section className="invite-card" aria-live="polite">
      <div className="brand-mark" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </div>
      {preview ? (
        <>
          <p className="onboarding-eyebrow">{t('householdInvitation')}</p>
          <h1>{t('inviteJoinTitle', { household: preview.householdName })}</h1>
          <p className="onboarding-copy">{t('inviteApprovalRequired')}</p>
        </>
      ) : error ? (
        <>
          <WarningCircle className="invite-status-icon" />
          <h1>{t('inviteUnavailableTitle')}</h1>
          <p className="onboarding-copy">{t('inviteUnavailableBody')}</p>
        </>
      ) : (
        <p className="onboarding-copy">{t('loading')}</p>
      )}
    </section>
  )
}

function InviteRequestPanel({
  token,
  preview,
  request,
  requestLoading,
  onRequested
}: {
  token: string
  preview: HouseholdInvitePreview | undefined
  request: HouseholdRequestState | undefined
  requestLoading: boolean
  onRequested(): void
}) {
  const { t } = useTranslation()
  const auth = useAuth()
  const client = useQueryClient()
  const approval = useRef(false)
  const join = useMutation({
    mutationFn: () => api.household.requestAccess(token),
    onSuccess: (next) => {
      client.setQueryData(['invite-request', token, auth.user?.id], next)
      onRequested()
    }
  })

  useEffect(() => {
    if (request?.status !== 'approved' || approval.current) return
    approval.current = true
    sessionStorage.removeItem('pending-invite-token')
    void auth.refreshProfile()
  }, [auth, request?.status])

  if (requestLoading)
    return <section className="invite-card invite-request-card">{t('loading')}</section>
  if (request?.status === 'pending') {
    return (
      <section className="invite-card invite-request-card">
        <Clock className="invite-status-icon" />
        <h2>{t('invitePendingTitle')}</h2>
        <p className="onboarding-copy">
          {t('invitePendingBody', { household: request.householdName })}
        </p>
      </section>
    )
  }
  if (request?.status === 'rejected' || request?.status === 'expired') {
    return (
      <section className="invite-card invite-request-card">
        <WarningCircle className="invite-status-icon" />
        <h2>{t('inviteRequestClosedTitle')}</h2>
        <p className="onboarding-copy">{t('inviteRequestClosedBody')}</p>
      </section>
    )
  }
  if (request?.status === 'approved') {
    return (
      <section className="invite-card invite-request-card">
        <CheckCircle className="invite-status-icon" />
        <h2>{t('inviteApprovedTitle')}</h2>
        <p className="onboarding-copy">{t('inviteApprovedBody')}</p>
      </section>
    )
  }

  return (
    <section className="invite-card invite-request-card">
      <h2>{t('inviteRequestTitle')}</h2>
      <p className="onboarding-copy">
        {preview
          ? t('inviteRequestBody', { household: preview.householdName })
          : t('inviteRequestGeneric')}
      </p>
      {join.error && (
        <p className="form-error" role="alert">
          {isApiErrorCode(join.error, 'email_confirmation_required')
            ? t('inviteEmailConfirmationRequired')
            : isApiErrorCode(join.error, 'household_capacity_reached')
              ? t('inviteCapacityReached')
              : t('requestFailed')}
        </p>
      )}
      <Button size="lg" onClick={() => join.mutate()} disabled={join.isPending || !preview}>
        {join.isPending ? t('inviteRequesting') : t('inviteRequestAccess')}
      </Button>
    </section>
  )
}
