import { describe, expect, it, beforeEach } from 'vitest'
import { buildMgmtAutoLoginScript } from '@/lib/mgmtAutoLogin'

/**
 * End-to-end check that the script we inject can be deobfuscated by
 * the *exact* algorithm used by `Cli-Proxy-API-Management-Center`'s
 * `secureStorage`. If this test ever breaks, the upstream panel has
 * changed its on-disk format and we need to re-mirror it.
 *
 * Algorithm mirror (from upstream `src/utils/encryption.ts`):
 *   key = TextEncoder("cli-proxy-api-webui::secure-storage|<host>|<UA>")
 *   plaintext = JSON.stringify({ state: {...}, version: 0 })
 *   stored = "enc::v1::" + base64(xor(plaintext, key))
 */
function deobfuscate(stored: string, host: string, ua: string): string {
  const PREFIX = 'enc::v1::'
  if (!stored.startsWith(PREFIX)) throw new Error('not obfuscated')
  const body = stored.slice(PREFIX.length)
  const bin = atob(body)
  const enc = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) enc[i] = bin.charCodeAt(i)
  const key = new TextEncoder().encode(
    `cli-proxy-api-webui::secure-storage|${host}|${ua}`,
  )
  const out = new Uint8Array(enc.length)
  for (let i = 0; i < enc.length; i++) out[i] = enc[i] ^ key[i % key.length]
  return new TextDecoder().decode(out)
}

describe('auto-login script roundtrip (matches upstream panel)', () => {
  beforeEach(() => {
    localStorage.clear()
    // jsdom doesn't navigate the page; force a deterministic host so
    // the eval and decoder use the same key bytes.
    Object.defineProperty(window, 'location', {
      value: { ...window.location, host: 'localhost:8317' },
      configurable: true,
    })
  })

  it('produces a localStorage value the upstream panel can decode', () => {
    const secret = 'TEST-secret-Key_42'
    const apiBase = 'http://localhost:8317'
    const script = buildMgmtAutoLoginScript({ apiBase, secretKey: secret })

    // Strip the trailing reload so the test environment doesn't try to
    // navigate during eval.
    const stripped = script.replace(/setTimeout\([^,]+,\d+\);/, '')

    new Function(stripped)()

    const stored = localStorage.getItem('cli-proxy-auth')
    expect(stored).toBeTruthy()
    expect(localStorage.getItem('isLoggedIn')).toBe('true')

    const decoded = deobfuscate(stored!, window.location.host, navigator.userAgent)
    const parsed = JSON.parse(decoded)
    expect(parsed.state.apiBase).toBe(apiBase)
    expect(parsed.state.managementKey).toBe(secret)
    expect(parsed.state.rememberPassword).toBe(true)
    expect(parsed.version).toBe(0)
  })

  it('is idempotent — second run does not re-write storage', () => {
    const script = buildMgmtAutoLoginScript({
      apiBase: 'http://localhost:8317',
      secretKey: 'k',
    })
    const stripped = script.replace(/setTimeout\([^,]+,\d+\);/, '')
    new Function(stripped)()
    const first = localStorage.getItem('cli-proxy-auth')

    // Tamper with the value, then run again. The early return must
    // keep our tamper because alreadySet + isLoggedIn are both true.
    localStorage.setItem('cli-proxy-auth', 'enc::v1::tampered')
    new Function(stripped)()
    expect(localStorage.getItem('cli-proxy-auth')).toBe('enc::v1::tampered')

    // Sanity: clearing isLoggedIn lets the script re-run.
    localStorage.removeItem('isLoggedIn')
    localStorage.setItem('cli-proxy-auth', first!)
    new Function(stripped)()
    expect(localStorage.getItem('isLoggedIn')).toBe('true')
  })
})
