import { Trash, UserPlus } from '@phosphor-icons/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth'
import { api } from '../lib/api'
import type { AdminUser } from '../lib/types'
import { Button } from './ui/button'
import { AppDrawer, ConfirmDialog } from './drawer'

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
  const [error, setError] = useState('')
  const householdId = auth.profile?.household_id
  const previousHouseholdId = useRef(householdId)
  const usersQueryKey = ['admin-users', householdId] as const
  useEffect(() => {
    if (previousHouseholdId.current === householdId) return
    setRemoveUser(null)
    setError('')
    previousHouseholdId.current = householdId
  }, [householdId])
  const users = useQuery({
    queryKey: usersQueryKey,
    queryFn: api.admin.list,
    enabled: open && Boolean(householdId)
  })
  const create = useMutation({
    mutationFn: ({ name, email, password }: { name: string; email: string; password: string }) =>
      api.admin.create(name, email, password),
    onSuccess: () => client.invalidateQueries({ queryKey: usersQueryKey }),
    onError: () => setError(t('requestFailed'))
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.admin.remove(id),
    onSuccess: () => client.invalidateQueries({ queryKey: usersQueryKey }),
    onError: () => setError(t('requestFailed'))
  })

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    const form = new FormData(event.currentTarget)
    create.mutate({
      name: String(form.get('name')).trim(),
      email: String(form.get('email')),
      password: String(form.get('password'))
    })
    event.currentTarget.reset()
  }

  return (
    <>
      <AppDrawer
        open={open}
        onOpenChange={onOpenChange}
        title={t('users')}
        className="admin-drawer"
      >
        <form className="admin-create" onSubmit={submit}>
          <div className="section-title">
            <UserPlus />
            <strong>{t('addUser')}</strong>
          </div>
          <label>
            <span>{t('userName')}</span>
            <input name="name" type="text" maxLength={80} required />
          </label>
          <label>
            <span>{t('email')}</span>
            <input name="email" type="email" required />
          </label>
          <label>
            <span>{t('password')}</span>
            <input name="password" type="password" minLength={8} required />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <Button size="lg" type="submit" disabled={create.isPending}>
            {create.isPending ? t('creatingUser') : t('createUser')}
          </Button>
        </form>
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
