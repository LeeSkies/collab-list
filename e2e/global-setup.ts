import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { FullConfig } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

type LocalSupabase = {
  API_URL: string
  SERVICE_ROLE_KEY: string
}

type TestIdentity = {
  id: string
  email: string
  password: string
}

export type E2eIdentityFixture = {
  prefix: string
  identities: Record<string, TestIdentity>
}

export const identityFixturePath = path.resolve('.playwright/e2e-identities.json')

function persistFixture(fixture: E2eIdentityFixture) {
  mkdirSync(path.dirname(identityFixturePath), { recursive: true })
  writeFileSync(identityFixturePath, JSON.stringify(fixture, null, 2))
}

function localSupabase(): LocalSupabase {
  const output = execFileSync('npx', ['supabase@2.109.1', 'status', '-o', 'env'], {
    encoding: 'utf8'
  })
  const values = Object.fromEntries(
    output.split('\n').flatMap((line) => {
      const match = line.match(/^([A-Z_]+)=(.*)$/)
      return match ? [[match[1], match[2].replace(/^['"]|['"]$/g, '')]] : []
    })
  ) as Partial<LocalSupabase>
  if (!values.API_URL || !values.SERVICE_ROLE_KEY) {
    throw new Error('Local Supabase status did not include API_URL and SERVICE_ROLE_KEY')
  }
  return { API_URL: values.API_URL, SERVICE_ROLE_KEY: values.SERVICE_ROLE_KEY }
}

export default async function globalSetup(config: FullConfig) {
  execFileSync('npx', ['supabase@2.109.1', 'db', 'reset'], { stdio: 'ignore' })
  const local = localSupabase()
  const admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  })
  const fixture: E2eIdentityFixture = {
    prefix: `e2e-${randomUUID()}`,
    identities: {}
  }
  persistFixture(fixture)

  for (const project of config.projects) {
    const identities = [
      [project.name, `E2E ${project.name}`],
      ...Array.from({ length: project.retries + 1 }, (_, retry) => [
        `${project.name}-verified-${retry}`,
        `E2E ${project.name} verified ${retry}`
      ]),
      ...Array.from({ length: project.retries + 1 }, (_, retry) => [
        `${project.name}-invite-admin-${retry}`,
        `E2E ${project.name} invite admin ${retry}`
      ]),
      ...Array.from({ length: project.retries + 1 }, (_, retry) => [
        `${project.name}-invitee-${retry}`,
        `E2E ${project.name} invitee ${retry}`
      ])
    ] as const
    for (const [identityKey, name] of identities) {
      const email = `${fixture.prefix}-${identityKey}@example.com`
      const password = 'password123'
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { name }
      })
      if (error || !data.user) throw error ?? new Error(`Could not create ${email}`)
      fixture.identities[identityKey] = { id: data.user.id, email, password }
      persistFixture(fixture)
    }
  }
}
