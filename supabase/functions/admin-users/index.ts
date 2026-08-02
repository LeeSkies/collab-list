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
    const { data: membership, error: membershipError } = await userClient
      .from('household_members')
      .select('household_id,role')
      .eq('user_id', auth.user.id)
      .eq('role', 'admin')
      .single()
    if (membershipError || membership?.role !== 'admin')
      return json({ error: 'Admin access required' }, 403)
    const householdId = membership.household_id
    const admin = createClient(url, service, {
      auth: { persistSession: false, autoRefreshToken: false }
    })
    const body = await request.json()
    if (body.action === 'list') {
      const { data: memberships, error: membershipsError } = await admin
        .from('household_members')
        .select('user_id,role')
        .eq('household_id', householdId)
        .order('created_at')
      if (membershipsError) throw membershipsError
      const userIds = memberships.map((item) => item.user_id)
      const { data: profiles, error: profilesError } = userIds.length
        ? await admin.from('profiles').select('id,name,email,created_at').in('id', userIds)
        : { data: [], error: null }
      if (profilesError) throw profilesError
      const profilesById = new Map(profiles.map((item) => [item.id, item]))
      return json({
        users: memberships.flatMap((item) => {
          const profile = profilesById.get(item.user_id)
          return profile
            ? [
                {
                  id: profile.id,
                  name: profile.name,
                  email: profile.email,
                  role: item.role,
                  createdAt: profile.created_at
                }
              ]
            : []
        })
      })
    }
    if (body.action === 'delete') {
      if (body.userId === auth.user.id)
        return json({ error: 'You cannot remove yourself from the household' }, 400)
      const { data: removed, error } = await admin
        .from('household_members')
        .delete()
        .eq('household_id', householdId)
        .eq('user_id', body.userId)
        .eq('role', 'member')
        .select('user_id')
      if (error) return json({ error: 'Could not remove household member', code: error.code }, 400)
      if (!removed.length) return json({ error: 'Household member not found' }, 404)
      return json({ ok: true })
    }
    return json({ error: 'Unknown action' }, 400)
  } catch (error) {
    console.error(error)
    return json({ error: 'Unexpected server error' }, 500)
  }
})
