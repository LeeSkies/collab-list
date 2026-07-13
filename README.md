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

These credentials are local fixtures only.

## Database workflow

All schema changes belong in `supabase/migrations`. Never make an undocumented hosted change.

```bash
npm run db:reset
npm run db:test
npm run db:lint
npm run types:supabase
```

The schema enforces duplicate product signatures, quantity bounds, optimistic versions, atomic quantity/pick operations, history insertion, and RLS. Product mutations go through authenticated database functions. Auth administration goes through `supabase/functions/admin-users`; its service-role credential remains server-side.

## Hosted Supabase

Authenticate the CLI with the ignored `SUPABASE_ACCESS_TOKEN`, then link and deploy:

```bash
set -a; source .env.local; set +a
npx supabase projects list
npx supabase link --project-ref <project-ref>
npx supabase db push
npx supabase functions deploy admin-users
```

In the hosted Auth settings, keep public email registration disabled. Create the initial admin through the Supabase dashboard or a one-time trusted script, then set that profile's role to `admin`. Add the hosted browser-safe URL and publishable key to the deployment environment; never expose the secret/service-role key.

## Verification

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
npm run db:test
npm run test:e2e
```

The PWA service worker caches only static build assets. Product data is not persisted for offline reading and mutations are never queued offline.
