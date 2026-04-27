import { useEffect, useState } from 'react'
import {
  checkCpaUpdate,
  downloadCpaUpdate,
  stopCpa,
  startCpa,
  type UpdateCheckResult,
} from '@/lib/tauri'
import { useCpaStore } from '@/stores/cpa'
import { listen } from '@tauri-apps/api/event'
import { getVersion } from '@tauri-apps/api/app'
import { ArrowUpRight } from 'lucide-react'

export function AboutPage() {
  const { status } = useCpaStore()
  const [appVersion, setAppVersion]   = useState('')
  const [update, setUpdate]           = useState<UpdateCheckResult | null>(null)
  const [checking, setChecking]       = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [progress, setProgress]       = useState<[number, number] | null>(null)
  const [done, setDone]               = useState(false)
  const [error, setError]             = useState('')

  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => setAppVersion('0.1.0'))

    const unsubs = [
      listen<[number, number]>('cpa:download-progress', (e) => setProgress(e.payload)),
      listen('cpa:download-complete', () => {
        setDone(true)
        setDownloading(false)
        setProgress(null)
        setTimeout(() => startCpa(), 300)
      }),
    ]
    return () => { unsubs.forEach((p) => p.then((fn) => fn())) }
  }, [])

  const handleCheck = async () => {
    setChecking(true)
    setError('')
    setDone(false)
    try {
      setUpdate(await checkCpaUpdate())
    } catch (e) {
      setError(String(e))
    }
    setChecking(false)
  }

  const handleUpdate = async () => {
    if (!update) return
    setDownloading(true)
    setDone(false)
    setError('')
    try {
      if (status === 'Running') await stopCpa()
      await downloadCpaUpdate(update.downloadUrl, update.latestVersion)
    } catch (e) {
      setError(String(e))
      setDownloading(false)
    }
  }

  const pct = progress ? Math.round((progress[0] / Math.max(progress[1], 1)) * 100) : 0

  const LINKS = [
    { label: 'CLIProxyAPI',        url: 'https://github.com/router-for-me/CLIProxyAPI' },
    { label: 'Documentation',      url: 'https://help.router-for.me/' },
    { label: 'CPA Desktop',        url: 'https://github.com/Tendo33/CPA-Desktop' },
  ]

  return (
    <div
      className="selectable"
      style={{ height: '100%', overflowY: 'auto', background: 'var(--c-bg)', padding: '28px 28px' }}
    >
      <div style={{ maxWidth: 460, display: 'flex', flexDirection: 'column', gap: 32 }}>

        {/* ── Identity ──────────────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Logomark */}
          <div style={{
            width: 44, height: 44,
            borderRadius: 11,
            background: 'var(--c-accent-bg)',
            border: '1px solid var(--c-accent-dim)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            marginBottom: 4,
          }}>
            <span style={{ fontSize: 20, fontWeight: 700, color: 'var(--c-accent)', letterSpacing: '-0.02em' }}>C</span>
          </div>

          <div>
            <h1 style={{ fontSize: 20, fontWeight: 600, color: 'var(--c-text-1)', letterSpacing: '-0.02em' }}>
              CPA Desktop
            </h1>
            <p style={{ fontSize: 12, color: 'var(--c-text-3)', marginTop: 4 }}>
              Desktop manager for CLIProxyAPI
            </p>
          </div>

          <div style={{ display: 'flex', gap: 16, marginTop: 2 }}>
            <VersionChip label="App" value={`v${appVersion}`} />
            {update?.currentVersion && (
              <VersionChip label="CPA" value={update.currentVersion} />
            )}
          </div>
        </div>

        {/* ── CLIProxyAPI Binary ────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <span style={{
            fontSize: 10, fontWeight: 600, letterSpacing: '0.1em',
            textTransform: 'uppercase', color: 'var(--c-accent)',
          }}>
            CLIProxyAPI Binary
          </span>

          {update && (
            <div
              style={{
                display: 'flex',
                gap: 24,
                padding: '10px 14px',
                background: 'var(--c-surface)',
                borderRadius: 8,
                border: '1px solid var(--c-border-sub)',
              }}
            >
              <div>
                <p style={{ fontSize: 10, color: 'var(--c-text-3)', marginBottom: 3 }}>Installed</p>
                <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--c-text-1)' }}>
                  {update.currentVersion ?? '—'}
                </p>
              </div>
              <div style={{ width: 1, background: 'var(--c-border-sub)', alignSelf: 'stretch' }} />
              <div>
                <p style={{ fontSize: 10, color: 'var(--c-text-3)', marginBottom: 3 }}>Latest</p>
                <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--c-text-1)' }}>
                  {update.latestVersion}
                </p>
              </div>
              {!update.updateAvailable && !done && (
                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center' }}>
                  <span style={{ fontSize: 11, color: 'var(--c-run)', fontWeight: 500 }}>
                    ✓ Up to date
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Progress */}
          {downloading && progress && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{
                height: 3,
                background: 'var(--c-raised)',
                borderRadius: 999,
                overflow: 'hidden',
              }}>
                <div
                  className="progress-shimmer"
                  style={{
                    height: '100%',
                    width: `${pct}%`,
                    borderRadius: 999,
                    transition: 'width 200ms ease',
                  }}
                />
              </div>
              <span style={{ fontSize: 11, color: 'var(--c-text-3)' }}>{pct}% downloaded</span>
            </div>
          )}

          {done && (
            <p style={{ fontSize: 12, color: 'var(--c-run)', fontWeight: 500 }}>
              ✓ Updated — CPA is restarting
            </p>
          )}

          {error && (
            <p style={{ fontSize: 11, color: 'var(--c-err)' }}>{error}</p>
          )}

          {/* Buttons */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={handleCheck}
              disabled={checking || downloading}
              className="btn btn-ghost"
            >
              {checking ? 'Checking…' : 'Check for Updates'}
            </button>

            {update?.updateAvailable && !done && (
              <button
                onClick={handleUpdate}
                disabled={downloading}
                className="btn btn-primary"
              >
                {downloading ? `Downloading ${pct}%` : `Update to ${update.latestVersion}`}
              </button>
            )}
          </div>
        </div>

        {/* ── Links ─────────────────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={{
            fontSize: 10, fontWeight: 600, letterSpacing: '0.1em',
            textTransform: 'uppercase', color: 'var(--c-accent)',
          }}>
            Links
          </span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {LINKS.map(({ label, url }) => (
              <a
                key={url}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '7px 0',
                  fontSize: 13,
                  color: 'var(--c-text-2)',
                  textDecoration: 'none',
                  borderBottom: '1px solid var(--c-border-sub)',
                  transition: 'color 120ms ease',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--c-text-1)')}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--c-text-2)')}
              >
                <span style={{ flex: 1 }}>{label}</span>
                <ArrowUpRight size={13} strokeWidth={1.75} style={{ color: 'var(--c-text-3)' }} />
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function VersionChip({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <span style={{ fontSize: 10, color: 'var(--c-text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>
        {label}
      </span>
      <span style={{
        fontSize: 11,
        fontWeight: 500,
        color: 'var(--c-text-2)',
        background: 'var(--c-raised)',
        border: '1px solid var(--c-border)',
        borderRadius: 4,
        padding: '1px 6px',
        fontVariantNumeric: 'tabular-nums',
      }}>
        {value}
      </span>
    </div>
  )
}
