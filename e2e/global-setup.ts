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

async function waitForAuth(apiUrl: string) {
  const timeoutAt = Date.now() + 60_000
  let lastFailure = 'no response'
  while (Date.now() < timeoutAt) {
    try {
      const response = await fetch(`${apiUrl}/auth/v1/health`)
      if (response.ok) return
      lastFailure = `HTTP ${response.status}: ${await response.text()}`
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error)
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
  throw new Error(`Local Supabase Auth did not become ready: ${lastFailure}`)
}

function selectedProjects(config: FullConfig) {
  const requested = new Set<string>()
  for (let index = 0; index < process.argv.length; index += 1) {
    const argument = process.argv[index]
    if (argument === '--project' && process.argv[index + 1]) {
      requested.add(process.argv[index + 1])
    } else if (argument.startsWith('--project=')) {
      requested.add(argument.slice('--project='.length))
    }
  }
  return requested.size === 0
    ? config.projects
    : config.projects.filter((project) => requested.has(project.name))
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
  await waitForAuth(local.API_URL)
  const admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  })
  const fixture: E2eIdentityFixture = {
    prefix: `e2e-${randomUUID()}`,
    identities: {}
  }
  persistFixture(fixture)

  // Only provision identities for projects selected by Playwright. This keeps
  // the CI fixture count below the local temporary signup cap when CI runs a
  // single project, while retaining all fixtures for an unfiltered local run.
  for (const project of selectedProjects(config)) {
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
      if (error || !data.user) {
        throw new Error(
          `Could not create ${email}: ${error?.name ?? 'unknown'}: ${error?.message ?? 'missing user'}`
        )
      }
      fixture.identities[identityKey] = { id: data.user.id, email, password }
      persistFixture(fixture)
    }
  }
}
