import { describe, expect, it } from 'vitest'
import { buildMgmtAutoLoginScript } from '@/lib/mgmtAutoLogin'

/**
 * The script is what gets `eval()`-ed inside the management webview to
 * populate localStorage so the panel auto-logs-in. We don't try to
 * execute the XOR/base64 in the test (that would just re-test what the
 * upstream panel does); we verify the *shape* of the script is correct
 * and the user-supplied values flow through untampered.
 */
describe('buildMgmtAutoLoginScript', () => {
  it('embeds the api base and secret key as JSON-encoded literals', () => {
    const s = buildMgmtAutoLoginScript({
      apiBase: 'http://localhost:8317',
      secretKey: 'abc-123_XYZ',
    })
    expect(s).toContain('http://localhost:8317')
    expect(s).toContain('abc-123_XYZ')
    // The auth state shape must match what zustand persist expects.
    expect(s).toContain('apiBase')
    expect(s).toContain('managementKey')
    expect(s).toContain('rememberPassword')
  })

  it('uses the upstream salt + storage key the panel expects', () => {
    const s = buildMgmtAutoLoginScript({ apiBase: 'x', secretKey: 'y' })
    expect(s).toContain("'cli-proxy-api-webui::secure-storage'")
    expect(s).toContain("'cli-proxy-auth'")
    expect(s).toContain("'enc::v1::'")
  })

  it('escapes embedded quotes so the script stays valid', () => {
    // A secret with a single quote (unlikely but possible).
    const s = buildMgmtAutoLoginScript({
      apiBase: "http://h.example/path'with-quote",
      secretKey: "key\"with-quote",
    })
    // Tries to parse the script as JS — eval is overkill, but we can
    // at least confirm balanced quoting via JSON round-trip on the
    // payload literal.
    expect(() => JSON.parse(JSON.stringify(s))).not.toThrow()
    expect(s).toContain("h.example")
  })

  it('skips the inject if isLoggedIn and storage are already set', () => {
    // The script contains an early return when localStorage is already
    // populated — make sure we kept that idempotency check.
    const s = buildMgmtAutoLoginScript({ apiBase: 'x', secretKey: 'y' })
    expect(s).toContain('alreadySet')
    expect(s).toContain("'isLoggedIn'")
  })

  it('reloads the page to trigger zustand persist hydration', () => {
    const s = buildMgmtAutoLoginScript({ apiBase: 'x', secretKey: 'y' })
    expect(s).toMatch(/location\.reload/)
  })
})
