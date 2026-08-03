import { createFileRoute } from '@tanstack/react-router'
import { useAuth } from '../auth'
import { GroceryApp } from '../components/grocery-app'
import { InviteHousehold } from '../components/invite-household'
import { SplashScreen } from '../components/splash-screen'
import { LoginForm } from '../components/login-form'

export const Route = createFileRoute('/invite/$token')({ component: InviteEntry })

function InviteEntry() {
  const auth = useAuth()
  const { token } = Route.useParams()
  if (auth.restoring)
    return <SplashScreen />
  if (auth.session && auth.profile?.household_id) return <GroceryApp />
  if (auth.session && auth.profile) return <InviteHousehold token={token} />
  return (
    <>
      <InviteHousehold token={token} />
      <LoginForm showCreateHousehold={false} inviteMode inviteToken={token} />
    </>
  )
}
