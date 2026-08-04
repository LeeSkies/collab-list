import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useAuth } from '../auth'
import { CreateHouseholdOnboarding } from '../components/create-household-onboarding'
import { DeletedHouseholdScreen } from '../components/deleted-household-screen'
import { GroceryApp } from '../components/grocery-app'
import { LoginForm } from '../components/login-form'
import { isSupabaseConfigured } from '../lib/supabase'
import { api } from '../lib/api'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  const auth = useAuth()
  const [createRequested, setCreateRequested] = useState(false)
  const [onboardingOpen, setOnboardingOpen] = useState(false)
  const deletedHousehold = useQuery({
    queryKey: ['deleted-household', auth.user?.id],
    queryFn: api.household.deleted,
    enabled: Boolean(auth.session),
    retry: false
  })
  const isInvitePath = window.location.pathname.startsWith('/invite/')
  if (!isSupabaseConfigured)
    return (
      <main className="config-missing">
        <h1>Supabase is not configured yet.</h1>
        <p>
          Copy <code>.env.example</code> to <code>.env.local</code> and add the browser-safe project
          values.
        </p>
      </main>
    )
  // Installed PWAs show the native manifest splash while auth restoration completes.
  if (auth.restoring) return null
  if (auth.session) {
    if (deletedHousehold.data) return <DeletedHouseholdScreen household={deletedHousehold.data} />
    if (auth.profile?.household_id && !onboardingOpen) return <GroceryApp />
    if (isInvitePath) return <LoginForm showCreateHousehold={false} inviteMode />
    return (
      <CreateHouseholdOnboarding
        onHouseholdCreated={() => setOnboardingOpen(true)}
        onContinueToList={() => setOnboardingOpen(false)}
      />
    )
  }
  if (createRequested && !isInvitePath)
    return (
      <CreateHouseholdOnboarding
        onBack={() => setCreateRequested(false)}
        onHouseholdCreated={() => setOnboardingOpen(true)}
        onContinueToList={() => setOnboardingOpen(false)}
      />
    )
  return (
    <LoginForm
      onCreateHousehold={() => setCreateRequested(true)}
      showCreateHousehold={!isInvitePath}
      inviteMode={isInvitePath}
    />
  )
}
