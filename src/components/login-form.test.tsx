import { describe, expect, it } from 'vitest'
import { inviteConfirmationRedirect } from './login-form'

describe('invite confirmation redirects', () => {
  it('keeps the app base path and token while removing auth query state', () => {
    const basePath = import.meta.env.BASE_URL.replace(/\/+$/, '')
    expect(
      inviteConfirmationRedirect(
        'abc123',
        'https://groceries.example/collab-list/sign-up?foo=bar#access_token=secret'
      )
    ).toBe(`https://groceries.example${basePath}/invite/abc123`)
  })
})
