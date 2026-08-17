import type { Session } from '@supabase/supabase-js'
import userEvent from '@testing-library/user-event'
import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getSession, onAuthStateChange, profileCurrent, householdCurrent, realtimeChannel, signUp } =
  vi.hoisted(() => ({
    getSession: vi.fn(),
    onAuthStateChange: vi.fn(),
    profileCurrent: vi.fn(),
    householdCurrent: vi.fn(),
    realtimeChannel: vi.fn(),
    signUp: vi.fn()
  }))

vi.mock('./lib/api', () => ({
  api: {
    profile: { current: profileCurrent },
    household: { current: householdCurrent }
  }
}))
vi.mock('./lib/supabase', () => ({
  supabase: {
    auth: { getSession, onAuthStateChange, signUp },
    channel: realtimeChannel
  }
}))

import { AuthProvider, useAuth } from './auth'

function session(id: string) {
  return { user: { id }, access_token: `${id}-token` } as unknown as Session
}

function profile(id: string, role: 'admin' | 'member' = 'member') {
  return {
    id,
    name: id,
    email: `${id}@example.com`,
    role,
    created_at: '2026-07-13T12:00:00.000Z',
    updated_at: '2026-07-13T12:00:00.000Z'
  }
}

function membership(id: string, householdId: string, role: 'admin' | 'member' = 'member') {
  return {
    user_id: id,
    household_id: householdId,
    role,
    created_at: '2026-07-13T12:00:00.000Z',
    updated_at: '2026-07-13T12:00:00.000Z'
  }
}

function Probe() {
  const auth = useAuth()
  return (
    <output data-testid="identity">
      {auth.session?.user.id ?? 'signed-out'}:{auth.profile?.id ?? 'no-profile'}:
      {auth.profile?.household_id ?? 'no-household'}
      <span data-testid="restoring">{String(auth.restoring)}</span>
    </output>
  )
}

function SignUpProbe() {
  const auth = useAuth()
  return (
    <>
      <span data-testid="restoring">{String(auth.restoring)}</span>
      <button onClick={() => void auth.signUp('new@example.com', 'password123', 'New User')} />
    </>
  )
}

function RefreshProbe() {
  const auth = useAuth()
  return <button onClick={() => void auth.refreshProfile()}>Refresh profile</button>
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe('AuthProvider profile identity guard', () => {
  let authCallback: ((event: string, next: Session | null) => void) | undefined
  let membershipCallback: (() => void) | undefined
  let membershipConfig: unknown

  beforeEach(() => {
    getSession.mockReset()
    onAuthStateChange.mockReset()
    profileCurrent.mockReset()
    householdCurrent.mockReset()
    realtimeChannel.mockReset()
    signUp.mockReset()
    authCallback = undefined
    membershipCallback = undefined
    membershipConfig = undefined
    onAuthStateChange.mockImplementation(
      (callback: (event: string, next: Session | null) => void) => {
        authCallback = callback
        return { data: { subscription: { unsubscribe: vi.fn() } } }
      }
    )
    realtimeChannel.mockImplementation(() => {
      const chain = {
        on: vi.fn((_event: string, config: unknown, callback: () => void) => {
          membershipConfig = config
          membershipCallback = callback
          return chain
        }),
        subscribe: vi.fn(() => chain),
        unsubscribe: vi.fn()
      }
      return chain
    })
  })

  afterEach(() => vi.restoreAllMocks())

  it('does not install a profile after the current user signs out', async () => {
    const current = session('user-a')
    const profileLoad = deferred<ReturnType<typeof profile>>()
    getSession.mockResolvedValue({ data: { session: current } })
    profileCurrent.mockReturnValue(profileLoad.promise)

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    )
    await waitFor(() => expect(profileCurrent).toHaveBeenCalledWith('user-a'))

    act(() => authCallback?.('SIGNED_OUT', null))
    profileLoad.resolve(profile('user-a'))

    await waitFor(() => expect(screen.getByTestId('identity')).toHaveTextContent('signed-out'))
    expect(screen.getByTestId('identity')).toHaveTextContent('no-profile')
    expect(householdCurrent).not.toHaveBeenCalled()
  })

  it('does not install a refreshed profile after the current user signs out', async () => {
    const current = session('user-a')
    const refreshLoad = deferred<ReturnType<typeof profile>>()
    getSession.mockResolvedValue({ data: { session: current } })
    profileCurrent.mockResolvedValue(profile('user-a'))
    householdCurrent.mockResolvedValue(membership('user-a', 'household-a'))

    const user = userEvent.setup()
    render(
      <AuthProvider>
        <Probe />
        <RefreshProbe />
      </AuthProvider>
    )
    await waitFor(() =>
      expect(screen.getByTestId('identity')).toHaveTextContent('user-a:user-a:household-a')
    )

    profileCurrent.mockReturnValueOnce(refreshLoad.promise)
    await user.click(screen.getByRole('button', { name: 'Refresh profile' }))
    await waitFor(() => expect(profileCurrent).toHaveBeenCalledTimes(2))

    act(() => authCallback?.('SIGNED_OUT', null))
    refreshLoad.resolve(profile('user-a', 'admin'))

    await waitFor(() =>
      expect(screen.getByTestId('identity')).toHaveTextContent('signed-out:no-profile:no-household')
    )
    expect(householdCurrent).toHaveBeenCalledTimes(1)
  })

  it('does not re-enter startup restoration when the current session token refreshes', async () => {
    const current = session('user-a')
    const refreshed = session('user-a')
    const profileReload = deferred<ReturnType<typeof profile>>()
    getSession.mockResolvedValue({ data: { session: current } })
    profileCurrent.mockResolvedValue(profile('user-a'))
    householdCurrent.mockResolvedValue(membership('user-a', 'household-a'))

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    )
    await waitFor(() => expect(screen.getByTestId('restoring')).toHaveTextContent('false'))

    profileCurrent.mockReturnValueOnce(profileReload.promise)
    act(() => authCallback?.('TOKEN_REFRESHED', refreshed))

    expect(screen.getByTestId('restoring')).toHaveTextContent('false')
    expect(screen.getByTestId('identity')).toHaveTextContent('user-a:user-a:household-a')

    profileReload.resolve(profile('user-a'))
    await waitFor(() => expect(profileCurrent).toHaveBeenCalledTimes(2))
  })

  it('keeps restoration pending until the profile and membership are loaded', async () => {
    const current = session('user-a')
    const profileLoad = deferred<ReturnType<typeof profile>>()
    const membershipLoad = deferred<ReturnType<typeof membership>>()
    getSession.mockResolvedValue({ data: { session: current } })
    profileCurrent.mockReturnValue(profileLoad.promise)
    householdCurrent.mockReturnValue(membershipLoad.promise)

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    )
    await waitFor(() => expect(profileCurrent).toHaveBeenCalledWith('user-a'))
    expect(screen.getByTestId('restoring')).toHaveTextContent('true')

    profileLoad.resolve(profile('user-a'))
    await waitFor(() => expect(householdCurrent).toHaveBeenCalledWith('user-a'))
    expect(screen.getByTestId('restoring')).toHaveTextContent('true')

    membershipLoad.resolve(membership('user-a', 'household-a'))
    await waitFor(() => expect(screen.getByTestId('restoring')).toHaveTextContent('false'))
    expect(screen.getByTestId('identity')).toHaveTextContent('user-a:user-a:household-a')
  })

  it('keeps an unassigned profile available after realtime membership removal', async () => {
    const current = session('user-a')
    getSession.mockResolvedValue({ data: { session: current } })
    profileCurrent.mockResolvedValue(profile('user-a'))
    householdCurrent
      .mockResolvedValueOnce(membership('user-a', 'household-a'))
      .mockRejectedValueOnce(new Error('membership not found'))

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    )
    await waitFor(() =>
      expect(screen.getByTestId('identity')).toHaveTextContent('user-a:user-a:household-a')
    )
    expect(membershipCallback).toBeDefined()
    expect(membershipConfig).toEqual({
      event: '*',
      schema: 'public',
      table: 'household_members',
      filter: 'user_id=eq.user-a'
    })

    act(() => membershipCallback?.())
    await waitFor(() =>
      expect(screen.getByTestId('identity')).toHaveTextContent('user-a:user-a:no-household')
    )
  })

  it('uses the Vite base URL for email confirmation redirects', async () => {
    getSession.mockResolvedValue({ data: { session: null } })
    signUp.mockResolvedValue({ data: { session: null }, error: null })

    const user = userEvent.setup()
    render(
      <AuthProvider>
        <SignUpProbe />
      </AuthProvider>
    )
    await waitFor(() => expect(screen.getByTestId('restoring')).toHaveTextContent('false'))

    await user.click(screen.getByRole('button'))
    expect(signUp).toHaveBeenCalledWith({
      email: 'new@example.com',
      password: 'password123',
      options: {
        data: { name: 'New User' },
        emailRedirectTo: new URL(import.meta.env.BASE_URL, window.location.origin).toString()
      }
    })
  })

  it('ignores a previous user load when the session switches users', async () => {
    const first = session('user-a')
    const second = session('user-b')
    const firstProfileLoad = deferred<ReturnType<typeof profile>>()
    getSession.mockResolvedValue({ data: { session: first } })
    profileCurrent.mockImplementation((id: string) =>
      id === 'user-a' ? firstProfileLoad.promise : Promise.resolve(profile('user-b'))
    )
    householdCurrent.mockResolvedValue(membership('user-b', 'household-b'))

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    )
    await waitFor(() => expect(profileCurrent).toHaveBeenCalledWith('user-a'))

    act(() => authCallback?.('SIGNED_IN', second))
    firstProfileLoad.resolve(profile('user-a', 'admin'))

    await waitFor(() =>
      expect(screen.getByTestId('identity')).toHaveTextContent('user-b:user-b:household-b')
    )
    expect(screen.getByTestId('identity')).not.toHaveTextContent('user-a')
  })
})
