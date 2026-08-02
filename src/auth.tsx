import type { Session, User } from '@supabase/supabase-js'
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api } from './lib/api'
import { supabase } from './lib/supabase'
import type { Profile } from './lib/types'

interface AuthValue {
  session: Session | null
  user: User | null
  profile: Profile | null
  restoring: boolean
  signIn(email: string, password: string): Promise<void>
  signOut(): Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [restoring, setRestoring] = useState(true)

  useEffect(() => {
    let active = true
    let loadVersion = 0
    let currentUserId: string | null = null

    function finishRestore(version: number) {
      if (active && version === loadVersion) setRestoring(false)
    }

    function applySession(next: Session | null) {
      const version = ++loadVersion
      const nextUserId = next?.user.id ?? null
      const userChanged = currentUserId !== nextUserId
      currentUserId = nextUserId
      setSession(next)
      if (userChanged) setProfile(null)
      setRestoring(Boolean(next))
      if (next) queueMicrotask(() => void loadProfile(next.user.id, version))
      else setRestoring(false)
    }

    async function loadProfile(id: string, version: number) {
      const profile = await api.profile.current(id).catch(() => null)
      if (!active || version !== loadVersion || currentUserId !== id) return
      if (!profile) {
        setProfile(null)
        finishRestore(version)
        return
      }
      const membership = await api.household.current(id).catch(() => null)
      if (!active || version !== loadVersion || currentUserId !== id) return
      setProfile(
        membership
          ? { ...profile, household_id: membership.household_id, role: membership.role }
          : null
      )
      finishRestore(version)
    }

    void supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!active || loadVersion !== 0) return
        applySession(data.session)
      })
      .catch(() => {
        if (!active || loadVersion !== 0) return
        applySession(null)
      })
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!active) return
      applySession(next)
    })
    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    const userId = session?.user.id
    if (!userId) return
    const authenticatedUserId = userId
    let active = true
    function revalidateMembership() {
      void api.household
        .current(authenticatedUserId)
        .then((membership) => {
          if (!active) return
          setProfile((current) =>
            current && membership && current.id === authenticatedUserId
              ? { ...current, household_id: membership.household_id, role: membership.role }
              : current
          )
        })
        .catch(() => {
          if (!active) return
          setProfile((current) => (current?.id === authenticatedUserId ? null : current))
        })
    }
    const channel = supabase
      .channel(`household-membership:${authenticatedUserId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'household_members',
          filter: `user_id=eq.${authenticatedUserId}`
        },
        revalidateMembership
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') revalidateMembership()
      })
    return () => {
      active = false
      void channel.unsubscribe()
    }
  }, [session?.user.id])

  const value = useMemo<AuthValue>(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      restoring,
      async signIn(email, password) {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      },
      async signOut() {
        await supabase.auth.signOut()
      }
    }),
    [profile, restoring, session]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used within AuthProvider')
  return value
}
