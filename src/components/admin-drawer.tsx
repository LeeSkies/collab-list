import { Check, Copy, LinkSimple, Trash, UserPlus, X } from '@phosphor-icons/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth'
import { api } from '../lib/api'
import type { AdminUser } from '../lib/types'
import { Button } from './ui/button'
import { AppDrawer, ConfirmDialog } from './drawer'
import { ResetHouseholdDialog } from './reset-household-dialog'

export function AdminDrawer({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange(open: boolean): void
}) {
  const { t } = useTranslation()
  const auth = useAuth()
  const client = useQueryClient()
  const [removeUser, setRemoveUser] = useState<AdminUser | null>(null)
  const [resetOpen, setResetOpen] = useState(false)
  const [error, setError] = useState('')
  const [inviteLink, setInviteLink] = useState('')
  const [copied, setCopied] = useState(false)
  const householdId = auth.profile?.household_id
  const isAdmin = auth.profile?.role === 'admin'
  const previousHouseholdId = useRef(householdId)
  const usersQueryKey = ['household-members', householdId] as const
  useEffect(() => {
    if (previousHouseholdId.current === householdId) return
    setRemoveUser(null)
    setError('')
    previousHouseholdId.current = householdId
  }, [householdId])
  const users = useQuery({
    queryKey: usersQueryKey,
    queryFn: () => api.household.members(householdId!),
    enabled: open && isAdmin && Boolean(householdId)
  })
  const pendingRequestsKey = ['household-requests', householdId] as const
  const pendingRequests = useQuery({
    queryKey: pendingRequestsKey,
    queryFn: () => api.household.pendingRequests(householdId!),
    enabled: open && isAdmin && Boolean(householdId)
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
    onError: () => setError(t('requestFailed'))
  })
  const handleRequest = useMutation({
    mutationFn: ({ requestId, approve }: { requestId: string; approve: boolean }) =>
      approve ? api.household.approveRequest(requestId) : api.household.rejectRequest(requestId),
    onSuccess: () => client.invalidateQueries({ queryKey: pendingRequestsKey }),
    onError: () => setError(t('requestFailed'))
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.household.removeMember(householdId!, id),
    onSuccess: () => client.invalidateQueries({ queryKey: usersQueryKey }),
    onError: () => setError(t('requestFailed'))
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
    onError: () => setError(t('requestFailed'))
  })

  if (!isAdmin) return null

  return (
    <>
      <AppDrawer
        open={open}
        onOpenChange={onOpenChange}
        title={t('users')}
        className="admin-drawer"
      >
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
            size="lg"
            onClick={() => createInvite.mutate()}
            disabled={createInvite.isPending}
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
                      disabled={handleRequest.isPending}
                      onClick={() =>
                        handleRequest.mutate({ requestId: request.requestId, approve: true })
                      }
                    >
                      <Check />
                    </button>
                    <button
                      type="button"
                      className="icon-button danger-quiet"
                      aria-label={`${t('reject')} ${request.name}`}
                      disabled={handleRequest.isPending}
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
        <section className="reset-management">
          <div className="section-title">
            <Trash />
            <strong>{t('resetHousehold')}</strong>
          </div>
          <p>{t('resetHouseholdDescription')}</p>
          <Button
            type="button"
            size="lg"
            variant="destructive"
            onClick={() => setResetOpen(true)}
            disabled={reset.isPending}
          >
            {t('resetHousehold')}
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
                  className="icon-button danger-quiet"
                  aria-label={`${t('removeMember')} ${user.name}`}
                  onClick={() => setRemoveUser(user)}
                >
                  <Trash />
                </button>
              )}
            </article>
          ))}
        </div>
      </AppDrawer>
      <ResetHouseholdDialog
        open={resetOpen}
        onOpenChange={setResetOpen}
        pending={reset.isPending}
        onConfirm={(options) => reset.mutate(options)}
      />
      {removeUser && (
        <ConfirmDialog
          open
          onOpenChange={(next) => !next && setRemoveUser(null)}
          title={t('removeMemberTitle', { name: removeUser.name })}
          body={t('removeMemberBody')}
          confirmLabel={t('removeMember')}
          destructive
          onConfirm={() => {
            remove.mutate(removeUser.id)
            setRemoveUser(null)
          }}
        />
      )}
    </>
  )
}
