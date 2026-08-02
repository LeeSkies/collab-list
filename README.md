# Shared Grocery List

A mobile-first shared grocery list built with React, TanStack Router/Query, Tailwind CSS v4, shadcn/Base UI, Motion, and Supabase.

## Requirements

- Node.js 22 (Node 20.19+ also works)
- Docker or another Docker-compatible container runtime
- npm

## Local setup

```bash
npm install
npm run db:start
npx supabase status -o env
```

Copy `.env.example` to `.env.local`. Keep the existing CLI token private, and add the local values printed by `supabase status`:

```dotenv
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_PUBLISHABLE_KEY=<ANON_KEY from supabase status>
```

Then run:

```bash
npm run dev
```

The local seed creates:

- `admin@example.com` / `password123`
- `member@example.com` / `password123`

These credentials are local fixtures only. Playwright creates unique, confirmed local identities for onboarding tests and removes them after the run.

## Database workflow

All schema changes belong in `supabase/migrations`. Never make an undocumented hosted change.

```bash
npm run db:reset
npm run db:test
npm run db:lint
npm run types:supabase
```

The schema enforces duplicate product signatures, quantity bounds, optimistic versions, atomic quantity/pick operations, product audit columns, and RLS; it does not include a `product_pick_history` table or API. Product mutations and household administration go through authenticated database functions.

## Hosted Supabase

Authenticate the CLI with the ignored `SUPABASE_ACCESS_TOKEN`, then link and deploy:

```bash
set -a; source .env.local; set +a
npx supabase projects list
npx supabase link --project-ref <project-ref>
npx supabase db push
```

In the hosted Auth settings, enable email/password registration with email confirmations for the create-household and invite flows. Email confirmation redirects preserve the current base path and invite token (for example, `/collab-list/invite/<token>` on GitHub Pages). Add the exact deployed app URL and the narrowly scoped invite path pattern (for example, `https://example.com/collab-list/` and `https://example.com/collab-list/invite/*`) to the hosted Auth redirect allowlist; do not use a host-wide wildcard. The local config includes equivalent localhost invite patterns. Create the initial migrated admin through the Supabase dashboard or a one-time trusted script, then set that profile's role to `admin`. After the tenancy migration, also provision the initial household and add that admin to `household_members`; setting `profiles.role` alone does not grant household access. Add the hosted browser-safe URL and publishable key to the deployment environment; never expose the secret/service-role key.

## Verification

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
npm run db:test
npm run db:lint
npm run test:e2e
```

Playwright starts and resets the local Supabase project before its run. It provisions unique confirmed users through the local admin API for the verified onboarding case, while signup tests still use the normal email-confirmation gate. Test users are deleted during teardown.

The PWA service worker caches only static build assets. Product data is not persisted for offline reading and mutations are never queued offline.
