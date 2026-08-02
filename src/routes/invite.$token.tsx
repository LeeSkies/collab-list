import { createFileRoute } from '@tanstack/react-router'
import { useAuth } from '../auth'
import { GroceryApp } from '../components/grocery-app'
import { LeafLoader } from '../components/leaf-loader'
import { LoginForm } from '../components/login-form'

export const Route = createFileRoute('/invite/$token')({ component: InviteEntry })

function InviteEntry() {
  const auth = useAuth()
  if (auth.restoring)
    return (
      <main className="loading-page">
        <LeafLoader />
      </main>
    )
  if (auth.session && auth.profile) return <GroceryApp />
  return <LoginForm showCreateHousehold={false} inviteMode />
}
