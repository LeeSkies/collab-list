import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' }
  })

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
    if (!token) return json({ error: 'Authentication required' }, 401)
    const userClient = createClient(url, anon, {
      global: { headers: { Authorization: `Bearer ${token}` } }
    })
    const { data: auth, error: authError } = await userClient.auth.getUser(token)
    if (authError || !auth.user) return json({ error: 'Authentication required' }, 401)
    const { data: profile } = await userClient
      .from('profiles')
      .select('role')
      .eq('id', auth.user.id)
      .single()
    if (profile?.role !== 'admin') return json({ error: 'Admin access required' }, 403)
    const admin = createClient(url, service, {
      auth: { persistSession: false, autoRefreshToken: false }
    })
    const body = await request.json()
    if (body.action === 'list') {
      const { data, error } = await admin
        .from('profiles')
        .select('id,email,role,created_at')
        .order('created_at')
      if (error) throw error
      return json({
        users: data.map((item) => ({
          id: item.id,
          email: item.email,
          role: item.role,
          createdAt: item.created_at
        }))
      })
    }
    if (body.action === 'create') {
      if (
        typeof body.email !== 'string' ||
        typeof body.password !== 'string' ||
        body.password.length < 8
      )
        return json({ error: 'Valid email and password are required' }, 400)
      const { data, error } = await admin.auth.admin.createUser({
        email: body.email.trim().toLowerCase(),
        password: body.password,
        email_confirm: true
      })
      if (error) return json({ error: 'Could not create user', code: error.code }, 400)
      return json(
        {
          user: {
            id: data.user.id,
            email: data.user.email,
            role: 'member',
            createdAt: data.user.created_at
          }
        },
        201
      )
    }
    if (body.action === 'delete') {
      if (body.userId === auth.user.id)
        return json({ error: 'You cannot delete your own account' }, 400)
      const { error } = await admin.auth.admin.deleteUser(body.userId)
      if (error) return json({ error: 'Could not delete user', code: error.code }, 400)
      return json({ ok: true })
    }
    return json({ error: 'Unknown action' }, 400)
  } catch (error) {
    console.error(error)
    return json({ error: 'Unexpected server error' }, 500)
  }
})
