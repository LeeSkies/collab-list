import { createFileRoute } from '@tanstack/react-router'
import { useAuth } from '../auth'
import { GroceryApp } from '../components/grocery-app'
import { LeafLoader } from '../components/leaf-loader'
import { LoginForm } from '../components/login-form'
import { isSupabaseConfigured } from '../lib/supabase'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  const auth = useAuth()
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
  return auth.session ? <GroceryApp /> : <LoginForm />
}
