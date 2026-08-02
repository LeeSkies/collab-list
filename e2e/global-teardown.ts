import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, unlinkSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { identityFixturePath, type E2eIdentityFixture } from './global-setup'

type LocalSupabase = {
  API_URL: string
  SERVICE_ROLE_KEY: string
}

function localSupabase(): LocalSupabase | null {
  const output = execFileSync('npx', ['supabase@2.109.1', 'status', '-o', 'env'], {
    encoding: 'utf8'
  })
  const values = Object.fromEntries(
    output.split('\n').flatMap((line) => {
      const match = line.match(/^([A-Z_]+)=(.*)$/)
      return match ? [[match[1], match[2].replace(/^['"]|['"]$/g, '')]] : []
    })
  ) as Partial<LocalSupabase>
  if (!values.API_URL || !values.SERVICE_ROLE_KEY) return null
  return { API_URL: values.API_URL, SERVICE_ROLE_KEY: values.SERVICE_ROLE_KEY }
}

// Use the local Postgres container for fixture cleanup instead of widening service-role table grants.
function localDatabaseContainer() {
  const output = execFileSync(
    'docker',
    ['ps', '--filter', 'label=com.supabase.cli.project=collab-list', '--format', '{{.Names}}'],
    { encoding: 'utf8' }
  )
  const container = output
    .split('\n')
    .map((name) => name.trim())
    .find((name) => name.startsWith('supabase_db_'))
  if (!container) throw new Error('Could not find the local Supabase database container')
  return container
}

function postgresQuery(container: string, sql: string) {
  return execFileSync(
    'docker',
    [
      'exec',
      container,
      'psql',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '--no-psqlrc',
      '--tuples-only',
      '--no-align',
      '--set',
      'ON_ERROR_STOP=1',
      '--command',
      sql
    ],
    { encoding: 'utf8' }
  )
}

function sqlUuidList(ids: string[]) {
  if (ids.some((id) => !/^[0-9a-f-]{36}$/i.test(id))) {
    throw new Error('Fixture contained an invalid user or household ID')
  }
  return ids.map((id) => `'${id}'::uuid`).join(', ')
}

async function usersWithPrefix(admin: ReturnType<typeof createClient>, prefix: string) {
  const users = []
  let page = 1
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw new Error(`Could not list local E2E users: ${error.message}`)
    users.push(...data.users.filter((user) => user.email?.startsWith(prefix)))
    if (data.users.length < 1000) return users
    page += 1
  }
}

function fixtureHouseholdIds(container: string, userIds: string[]) {
  if (userIds.length === 0) return []
  const output = postgresQuery(
    container,
    `select distinct household_id
       from public.household_members
      where user_id in (${sqlUuidList(userIds)})
      order by household_id`
  )
  return output
    .split('\n')
    .map((householdId) => householdId.trim())
    .filter(Boolean)
}

function deleteFixtureHouseholds(container: string, householdIds: string[]) {
  if (householdIds.length === 0) return
  postgresQuery(
    container,
    `delete from public.households
      where id in (${sqlUuidList(householdIds)})`
  )
}

function assertHouseholdsRemoved(container: string, householdIds: string[]) {
  if (householdIds.length === 0) return
  const checks = [
    ['households', 'id'],
    ['household_trials', 'household_id'],
    ['products', 'household_id'],
    ['household_members', 'household_id']
  ] as const
  for (const [table, column] of checks) {
    const output = postgresQuery(
      container,
      `select count(*)
         from public.${table}
        where ${column} in (${sqlUuidList(householdIds)})`
    )
    const remaining = Number(output.trim())
    if (remaining > 0) throw new Error(`Fixture cleanup left ${remaining} rows in ${table}`)
  }
}

export default async function globalTeardown() {
  let cleanupError: unknown
  try {
    if (existsSync(identityFixturePath)) {
      const fixture = JSON.parse(readFileSync(identityFixturePath, 'utf8')) as E2eIdentityFixture
      const local = localSupabase()
      if (!local) throw new Error('Local Supabase status did not include cleanup credentials')

      const admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false }
      })
      const matchingUsers = await usersWithPrefix(admin, fixture.prefix)
      const fixtureUserIds = matchingUsers.map((user) => user.id)
      const databaseContainer = localDatabaseContainer()
      const householdIds = fixtureHouseholdIds(databaseContainer, fixtureUserIds)

      deleteFixtureHouseholds(databaseContainer, householdIds)
      assertHouseholdsRemoved(databaseContainer, householdIds)

      for (const user of matchingUsers) {
        const { error } = await admin.auth.admin.deleteUser(user.id)
        if (error) throw new Error(`Could not delete fixture user ${user.id}: ${error.message}`)
      }

      const remainingUsers = await usersWithPrefix(admin, fixture.prefix)
      if (remainingUsers.length > 0) {
        throw new Error(`Fixture cleanup left ${remainingUsers.length} users`)
      }
    }
  } catch (error) {
    cleanupError = error
  }

  let stopError: unknown
  try {
    execFileSync('npx', ['supabase@2.109.1', 'stop'], { stdio: 'inherit' })
  } catch (error) {
    stopError = error
  }

  if (!cleanupError && !stopError && existsSync(identityFixturePath))
    unlinkSync(identityFixturePath)
  if (cleanupError && stopError) {
    throw new AggregateError([cleanupError, stopError], 'E2E cleanup and Supabase stop failed')
  }
  if (cleanupError) throw cleanupError
  if (stopError) throw stopError
}
