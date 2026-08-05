import { Check, Copy, CreditCard, LinkSimple, Trash, UserPlus, X } from '@phosphor-icons/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { TFunction } from 'i18next'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth'
import { api, isApiErrorCode } from '../lib/api'
import { formatChargeMinorUnits } from '../lib/money'
import type {
  AdminUser,
  BillingActionType,
  HouseholdEntitlement,
  HouseholdSubscription,
  PendingHouseholdRequest
} from '../lib/types'
import { Button } from './ui/button'
import { AppDrawer, ConfirmDialog } from './drawer'
import { ResetHouseholdDialog } from './reset-household-dialog'
import { DeleteHouseholdDialog } from './delete-household-dialog'

type PlanAction = 'subscribe' | 'cancel' | 'resubscribe' | 'none'

function isLiveSubscription(subscription: HouseholdSubscription) {
  return subscription.status === 'active' || subscription.status === 'trialing'
}

function formatPlanDate(iso: string, locale: string) {
  const dateLocale = locale.startsWith('ar')
    ? 'ar-EG'
    : locale.startsWith('fr')
      ? 'fr-FR'
      : locale.startsWith('he')
        ? 'he-IL'
        : 'en-GB'
  return new Intl.DateTimeFormat(dateLocale, { dateStyle: 'medium' }).format(new Date(iso))
}

function planActionFor(
  subscription: HouseholdSubscription,
  entitlement: HouseholdEntitlement | undefined
): PlanAction {
  if (subscription.status === 'none') {
    if (!subscription.billing_enabled) return 'none'
    const state = entitlement?.access_state
    return state === 'active_trial' || state === 'read_only_grace' || state === 'unavailable_locked'
      ? 'subscribe'
      : 'none'
  }
  const withinPeriod = Boolean(
    subscription.current_period_end &&
    new Date(subscription.current_period_end).getTime() > Date.now()
  )
  if (!withinPeriod || !isLiveSubscription(subscription)) return 'resubscribe'
  return subscription.cancel_at_period_end ? 'resubscribe' : 'cancel'
}

function planSummaryFor(
  subscription: HouseholdSubscription,
  entitlement: HouseholdEntitlement | undefined,
  locale: string,
  t: TFunction
): { title: string; detail: string } {
  const limit = subscription.base_seat_allowance + subscription.add_on_seat_count
  const seats = t('planSeats', { used: subscription.active_member_count, limit })
  if (subscription.status === 'none') {
    if (entitlement?.access_state === 'active_trial' && entitlement.trial_ends_at) {
      return {
        title: t('planTrialActive', { date: formatPlanDate(entitlement.trial_ends_at, locale) }),
        detail: seats
      }
    }
    if (entitlement?.access_state === 'read_only_grace' && entitlement.grace_ends_at) {
      return {
        title: t('planTrialGrace', { date: formatPlanDate(entitlement.grace_ends_at, locale) }),
        detail: seats
      }
    }
    if (entitlement?.access_state === 'unavailable_locked') {
      return { title: t('planTrialLocked'), detail: seats }
    }
    return { title: t('planNoSubscription'), detail: seats }
  }
  const withinPeriod = Boolean(
    subscription.current_period_end &&
    new Date(subscription.current_period_end).getTime() > Date.now()
  )
  const detail = [
    seats,
    subscription.add_on_seat_count > 0 &&
    subscription.add_on_unit_amount_minor_units != null &&
    subscription.currency
      ? t('planAddOnCharge', {
          count: subscription.add_on_seat_count,
          amount: formatChargeMinorUnits(
            subscription.add_on_unit_amount_minor_units,
            subscription.currency,
            locale
          )
        })
      : ''
  ]
    .filter(Boolean)
    .join(' · ')
  if (withinPeriod && subscription.current_period_end) {
    const date = formatPlanDate(subscription.current_period_end, locale)
    if (!isLiveSubscription(subscription)) {
      return { title: t('planNeedsAttention'), detail }
    }
    return {
      title: subscription.cancel_at_period_end
        ? t('planCancelsAt', { date })
        : t('planActive', { date }),
      detail
    }
  }
  if (subscription.grace_ends_at && new Date(subscription.grace_ends_at).getTime() > Date.now()) {
    return {
      title: t('planGrace', { date: formatPlanDate(subscription.grace_ends_at, locale) }),
      detail
    }
  }
  return { title: t('planLocked'), detail }
}

export function AdminDrawer({
  open,
  onOpenChange,
  canMutate = true,
  embedded = false
}: {
  open: boolean
  onOpenChange(open: boolean): void
  canMutate?: boolean
  /** Render only the content (and dialogs) for embedding in the settings hub. */
  embedded?: boolean
}) {
  const { t, i18n } = useTranslation()
  const auth = useAuth()
  const client = useQueryClient()
  const locale = i18n.resolvedLanguage ?? i18n.language
  const [removeUser, setRemoveUser] = useState<AdminUser | null>(null)
  const [resetOpen, setResetOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [error, setError] = useState('')
  const [planNotice, setPlanNotice] = useState('')
  const [pendingAction, setPendingAction] = useState<BillingActionType | null>(null)
  const [addOnConfirm, setAddOnConfirm] = useState<PendingHouseholdRequest | null>(null)
  const [inviteLink, setInviteLink] = useState('')
  const [copied, setCopied] = useState(false)
  const householdId = auth.profile?.household_id
  const isAdmin = auth.profile?.role === 'admin'
  const previousHouseholdId = useRef(householdId)
  const usersQueryKey = ['household-members', householdId] as const
  function mutationError(reason: unknown) {
    if (
      isApiErrorCode(reason, 'household_read_only') ||
      isApiErrorCode(reason, 'household_entitlement_locked')
    ) {
      void client.invalidateQueries({ queryKey: ['household-entitlement', householdId] })
    }
    setError(
      isApiErrorCode(reason, 'household_read_only')
        ? boundaryIsPaid
          ? t('householdReadOnlyPaid')
          : t('householdReadOnly')
        : isApiErrorCode(reason, 'household_entitlement_locked')
          ? boundaryIsPaid
            ? t('householdLockedPaid')
            : t('householdLocked')
          : isApiErrorCode(reason, 'add_on_charge_not_configured')
            ? t('addOnChargeNotConfigured')
            : isApiErrorCode(reason, 'add_on_charge_confirmation_required')
              ? t('addOnChargeConfirmationRequired')
              : isApiErrorCode(reason, 'paid_subscription_required')
                ? t('paidSubscriptionRequired')
                : isApiErrorCode(reason, 'billing_disabled')
                  ? t('billingDisabled')
                  : isApiErrorCode(reason, 'billing_action_pending')
                    ? t('billingActionPending')
                    : isApiErrorCode(reason, 'no_active_subscription')
                      ? t('noActiveSubscription')
                      : isApiErrorCode(reason, 'subscription_already_active')
                        ? t('subscriptionAlreadyActive')
                        : isApiErrorCode(reason, 'no_subscription_to_resubscribe')
                          ? t('noSubscriptionToResubscribe')
                          : t('requestFailed')
    )
  }
  useEffect(() => {
    if (previousHouseholdId.current === householdId) return
    setRemoveUser(null)
    setError('')
    setPlanNotice('')
    setPendingAction(null)
    setAddOnConfirm(null)
    previousHouseholdId.current = householdId
  }, [householdId])
  const users = useQuery({
    queryKey: usersQueryKey,
    queryFn: () => api.household.members(householdId!),
    enabled: open && isAdmin && Boolean(householdId),
    retry: 0,
    staleTime: 30_000
  })
  const pendingRequestsKey = ['household-requests', householdId] as const
  const pendingRequests = useQuery({
    queryKey: pendingRequestsKey,
    queryFn: () => api.household.pendingRequests(householdId!),
    enabled: open && isAdmin && Boolean(householdId),
    retry: 0,
    staleTime: 30_000
  })
  const subscription = useQuery({
    queryKey: ['household-subscription', householdId],
    queryFn: api.household.subscription,
    enabled: open && isAdmin && Boolean(householdId),
    retry: 0,
    staleTime: 30_000
  })
  const boundaryIsPaid = Boolean(subscription.data && subscription.data.status !== 'none')
  const entitlement = useQuery({
    queryKey: ['household-entitlement', householdId],
    queryFn: api.household.entitlement,
    enabled: open && isAdmin && Boolean(householdId),
    retry: 0,
    staleTime: 30_000
  })
  const createInvite = useMutation({
    mutationFn: api.household.invite,
    onSuccess: ({ token }) => {
      const base = import.meta.env.BASE_URL.endsWith('/')
        ? import.meta.env.BASE_URL
        : `${import.meta.env.BASE_URL}/`
      setInviteLink(new URL(`${base}invite/${token}`, window.location.origin).toString())
      setCopied(false)
    },
    onError: mutationError
  })
  const handleRequest = useMutation({
    mutationFn: ({
      requestId,
      approve,
      confirmAddOnCharge = false
    }: {
      requestId: string
      approve: boolean
      confirmAddOnCharge?: boolean
    }) =>
      approve
        ? api.household.approveRequest(requestId, confirmAddOnCharge)
        : api.household.rejectRequest(requestId),
    onSuccess: () => client.invalidateQueries({ queryKey: pendingRequestsKey }),
    onError: mutationError
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.household.removeMember(householdId!, id),
    onSuccess: () => client.invalidateQueries({ queryKey: usersQueryKey }),
    onError: mutationError
  })
  const deleteHousehold = useMutation({
    mutationFn: (purgeNow: boolean) => api.household.delete(purgeNow),
    onSuccess: async () => {
      const deletedHouseholdId = householdId
      setDeleteOpen(false)
      if (deletedHouseholdId) {
        client.removeQueries({ queryKey: ['household-members', deletedHouseholdId], exact: true })
        client.removeQueries({ queryKey: ['household-requests', deletedHouseholdId], exact: true })
        client.removeQueries({
          queryKey: ['household-subscription', deletedHouseholdId],
          exact: true
        })
        client.removeQueries({
          queryKey: ['household-entitlement', deletedHouseholdId],
          exact: true
        })
        client.removeQueries({ queryKey: ['products', deletedHouseholdId], exact: true })
      }
      await auth.refreshProfile()
      if (auth.user?.id) {
        await client.invalidateQueries({ queryKey: ['deleted-household', auth.user.id] })
      }
    },
    onError: mutationError
  })
  const reset = useMutation({
    mutationFn: ({
      clearProducts,
      removeMembers
    }: {
      clearProducts: boolean
      removeMembers: boolean
    }) => api.household.reset(clearProducts, removeMembers),
    onSuccess: (_, { clearProducts }) => {
      if (clearProducts && householdId) {
        client.setQueryData(['products', householdId], [])
      }
      void client.invalidateQueries({ queryKey: usersQueryKey })
      void client.invalidateQueries({ queryKey: pendingRequestsKey })
    },
    onError: mutationError
  })
  const billingAction = useMutation({
    mutationFn: (action: BillingActionType) => api.household.requestBillingAction(action),
    onSuccess: () => {
      setPendingAction(null)
      setPlanNotice(t('planRequestSubmitted'))
      void client.invalidateQueries({ queryKey: ['household-subscription', householdId] })
      void client.invalidateQueries({ queryKey: ['household-entitlement', householdId] })
    },
    onError: (reason) => {
      setPendingAction(null)
      mutationError(reason)
    }
  })

  function approveClick(request: PendingHouseholdRequest) {
    const plan = subscription.data
    if (plan && plan.active_member_count >= 5) {
      if (plan.add_on_unit_amount_minor_units != null && plan.currency) {
        setAddOnConfirm(request)
      } else {
        handleRequest.mutate({ requestId: request.requestId, approve: true })
      }
      return
    }
    handleRequest.mutate({ requestId: request.requestId, approve: true })
  }

  if (!isAdmin) return null

  const planAction = planActionFor(subscription.data ?? emptySubscription, entitlement.data)
  const planSummary = planSummaryFor(
    subscription.data ?? emptySubscription,
    entitlement.data,
    locale,
    t
  )

  const content = (
    <>
      <section className="invite-management">
        <div className="section-title">
          <LinkSimple />
          <strong>{t('inviteMember')}</strong>
        </div>
        <p>{t('inviteLinkReady')}</p>
        {inviteLink && (
          <div className="invite-link-row">
            <input value={inviteLink} readOnly aria-label={t('inviteMember')} />
            <button
              type="button"
              className="icon-button"
              aria-label={t('copyInvite')}
              onClick={() => {
                void navigator.clipboard?.writeText(inviteLink)
                setCopied(true)
              }}
            >
              {copied ? <Check /> : <Copy />}
            </button>
          </div>
        )}
        {copied && <small role="status">{t('inviteCopied')}</small>}
        <Button
          type="button"
          onClick={() => createInvite.mutate()}
          disabled={createInvite.isPending || !canMutate}
        >
          {createInvite.isPending
            ? t('inviteRequesting')
            : inviteLink
              ? t('rotateInvite')
              : t('generateInvite')}
        </Button>
      </section>
      <section className="pending-requests">
        <div className="section-title">
          <UserPlus />
          <strong>{t('pendingRequests')}</strong>
          {pendingRequests.data && pendingRequests.data.length > 0 && (
            <span className="pending-count">{pendingRequests.data.length}</span>
          )}
        </div>
        {pendingRequests.data?.length ? (
          <div className="pending-request-list">
            {pendingRequests.data.map((request) => (
              <article key={request.requestId}>
                <div>
                  <strong>{request.name}</strong>
                  <small>{request.email}</small>
                </div>
                <div className="pending-request-actions">
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`${t('approve')} ${request.name}`}
                    disabled={handleRequest.isPending || !canMutate}
                    onClick={() => approveClick(request)}
                  >
                    <Check />
                  </button>
                  <button
                    type="button"
                    className="icon-button danger-quiet"
                    aria-label={`${t('reject')} ${request.name}`}
                    disabled={handleRequest.isPending || !canMutate}
                    onClick={() =>
                      handleRequest.mutate({ requestId: request.requestId, approve: false })
                    }
                  >
                    <X />
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="admin-empty">{t('noPendingRequests')}</p>
        )}
      </section>
      <section className="plan-management">
        <div className="section-title">
          <CreditCard />
          <strong>{t('plan')}</strong>
        </div>
        {subscription.data ? (
          <>
            <p className="plan-summary">{planSummary.title}</p>
            <p className="admin-empty">{planSummary.detail}</p>
            {planNotice && (
              <small className="plan-notice" role="status">
                {planNotice}
              </small>
            )}
            {subscription.data.billing_enabled && (
              <div className="plan-actions">
                {planAction === 'subscribe' && (
                  <Button
                    type="button"
                    onClick={() => setPendingAction('subscribe')}
                    disabled={billingAction.isPending}
                  >
                    {t('planSubscribe')}
                  </Button>
                )}
                {planAction === 'cancel' && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setPendingAction('cancel_at_period_end')}
                    disabled={billingAction.isPending}
                  >
                    {t('planCancel')}
                  </Button>
                )}
                {planAction === 'resubscribe' && (
                  <Button
                    type="button"
                    onClick={() => setPendingAction('resubscribe')}
                    disabled={billingAction.isPending}
                  >
                    {t('planResubscribe')}
                  </Button>
                )}
              </div>
            )}
          </>
        ) : (
          <p className="admin-empty">{t('loading')}</p>
        )}
      </section>
      <section className="reset-management">
        <div className="section-title">
          <Trash />
          <strong>{t('resetHousehold')}</strong>
        </div>
        <p>{t('resetHouseholdDescription')}</p>
        <Button
          type="button"
          variant="destructive"
          onClick={() => setResetOpen(true)}
          disabled={reset.isPending || !canMutate}
        >
          {t('resetHousehold')}
        </Button>
      </section>
      <section className="reset-management">
        <div className="section-title">
          <Trash />
          <strong>{t('deleteHousehold')}</strong>
        </div>
        <p>{t('deleteHouseholdDescription')}</p>
        <Button
          type="button"
          variant="destructive"
          onClick={() => setDeleteOpen(true)}
          disabled={deleteHousehold.isPending}
        >
          {t('deleteHousehold')}
        </Button>
      </section>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="user-list">
        {users.data?.map((user) => (
          <article key={user.id}>
            <div className="avatar">{user.name.slice(0, 1).toLocaleUpperCase()}</div>
            <div>
              <strong>{user.name}</strong>
              <small>{user.email}</small>
              <span>
                {user.role === 'admin' ? 'Admin' : t('member')}
                {user.id === auth.user?.id ? ` · ${t('currentUser')}` : ''}
              </span>
            </div>
            {user.id !== auth.user?.id && (
              <button
                type="button"
                className="icon-button danger-quiet"
                aria-label={`${t('removeMember')} ${user.name}`}
                onClick={() => setRemoveUser(user)}
                disabled={!canMutate || remove.isPending}
              >
                <Trash />
              </button>
            )}
          </article>
        ))}
      </div>
    </>
  )

  const shell = embedded ? null : (
    <AppDrawer open={open} onOpenChange={onOpenChange} title={t('users')} className="admin-drawer">
      {content}
    </AppDrawer>
  )

  return (
    <>
      {shell}
      {embedded && content}
      <DeleteHouseholdDialog
        key={deleteOpen ? 'delete-household-open' : 'delete-household-closed'}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        pending={deleteHousehold.isPending}
        onConfirm={(purgeNow) => deleteHousehold.mutate(purgeNow)}
      />
      <ResetHouseholdDialog
        open={resetOpen}
        onOpenChange={setResetOpen}
        pending={reset.isPending}
        onConfirm={(options) => reset.mutate(options)}
        canMutate={canMutate}
      />
      {removeUser && (
        <ConfirmDialog
          open
          onOpenChange={(next) => !next && setRemoveUser(null)}
          title={t('removeMemberTitle', { name: removeUser.name })}
          body={t('removeMemberBody')}
          confirmLabel={t('removeMember')}
          destructive
          pending={remove.isPending || !canMutate}
          onConfirm={() => {
            if (!canMutate) return
            remove.mutate(removeUser.id)
            setRemoveUser(null)
          }}
        />
      )}
      {pendingAction && (
        <ConfirmDialog
          open
          onOpenChange={(next) => !next && setPendingAction(null)}
          title={
            pendingAction === 'subscribe'
              ? t('planSubscribeTitle')
              : pendingAction === 'cancel_at_period_end'
                ? t('planCancelTitle')
                : t('planResubscribeTitle')
          }
          body={
            pendingAction === 'subscribe'
              ? t('planSubscribeBody')
              : pendingAction === 'cancel_at_period_end'
                ? t('planCancelBody')
                : t('planResubscribeBody')
          }
          confirmLabel={
            pendingAction === 'subscribe'
              ? t('planSubscribe')
              : pendingAction === 'cancel_at_period_end'
                ? t('planCancel')
                : t('planResubscribe')
          }
          destructive={pendingAction === 'cancel_at_period_end'}
          pending={billingAction.isPending}
          onConfirm={() => billingAction.mutate(pendingAction)}
        />
      )}
      {addOnConfirm && subscription.data && (
        <ConfirmDialog
          open
          onOpenChange={(next) => !next && setAddOnConfirm(null)}
          title={t('addOnChargeTitle', { name: addOnConfirm.name })}
          body={t('addOnChargeBody', {
            amount: formatChargeMinorUnits(
              subscription.data.add_on_unit_amount_minor_units!,
              subscription.data.currency!,
              locale
            )
          })}
          confirmLabel={t('approve')}
          pending={handleRequest.isPending}
          onConfirm={() => {
            handleRequest.mutate({
              requestId: addOnConfirm.requestId,
              approve: true,
              confirmAddOnCharge: true
            })
            setAddOnConfirm(null)
          }}
        />
      )}
    </>
  )
}

const emptySubscription: HouseholdSubscription = {
  household_id: '',
  status: 'none',
  provider: null,
  provider_subscription_id: null,
  current_period_start: null,
  current_period_end: null,
  grace_ends_at: null,
  cancel_at_period_end: false,
  canceled_at: null,
  base_seat_allowance: 5,
  add_on_seat_count: 0,
  add_on_unit_amount_minor_units: null,
  currency: null,
  provider_event_id: null,
  active_member_count: 0,
  billed_seat_count: 0,
  billing_enabled: false
}
