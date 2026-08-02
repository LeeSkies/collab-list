import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { useAuth } from '../auth'
import { CreateHouseholdOnboarding } from '../components/create-household-onboarding'
import { GroceryApp } from '../components/grocery-app'
import { LeafLoader } from '../components/leaf-loader'
import { LoginForm } from '../components/login-form'
import { isSupabaseConfigured } from '../lib/supabase'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  const auth = useAuth()
  const [createRequested, setCreateRequested] = useState(false)
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
  if (auth.restoring)
    return (
      <main className="loading-page">
        <LeafLoader />
      </main>
    )
  if (auth.session) {
    if (auth.profile) return <GroceryApp />
    if (isInvitePath) return <LoginForm showCreateHousehold={false} inviteMode />
    return <CreateHouseholdOnboarding />
  }
  if (createRequested && !isInvitePath)
    return <CreateHouseholdOnboarding onBack={() => setCreateRequested(false)} />
  return (
    <LoginForm
      onCreateHousehold={() => setCreateRequested(true)}
      showCreateHousehold={!isInvitePath}
      inviteMode={isInvitePath}
    />
  )
}
