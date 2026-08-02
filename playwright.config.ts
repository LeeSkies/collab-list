import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: 'http://127.0.0.1:5173', trace: 'on-first-retry', screenshot: 'only-on-failure' },
  webServer: {
    command: [
      "trap 'npx supabase@2.109.1 stop >/dev/null 2>&1 || true' EXIT",
      'npx supabase@2.109.1 start >/dev/null',
      'eval "$(npx supabase@2.109.1 status -o env)"',
      'VITE_SUPABASE_URL="$API_URL" VITE_SUPABASE_PUBLISHABLE_KEY="$ANON_KEY" npm run dev -- --host 127.0.0.1'
    ].join(' && '),
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: false
  },
  projects: [
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } }
  ]
})
