import { useEffect, useState } from 'react'
import {
  checkCpaUpdate,
  downloadCpaUpdate,
  externalUpdateInstructions,
  getInstallSourceInfo,
  getSettings,
  openLogsFolder,
  stopCpa,
  startCpa,
  upgradeViaBrew,
  type ExternalUpdateInstructions,
  type InstallSource,
  type LastPanic,
  type UpdateCheckResult,
} from '@/lib/tauri'
import { useCpaStore } from '@/stores/cpa'
import { listen } from '@tauri-apps/api/event'
import { getVersion } from '@tauri-apps/api/app'
import { ArrowUpRight } from 'lucide-react'
import { useT } from '@/lib/i18n'
import { Button, Modal } from '@/components/ui'

export function AboutPage() {
  const { status } = useCpaStore()
  const t = useT()
  const [appVersion, setAppVersion] = useState('')
  const [update, setUpdate] = useState<UpdateCheckResult | null>(null)
  const [checking, setChecking] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [progress, setProgress] = useState<[number, number] | null>(null)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  const [lastPanic, setLastPanic] = useState<LastPanic | null>(null)
  const [brewLog, setBrewLog] = useState('')
  const [brewOpen, setBrewOpen] = useState(false)
  const [externalOpen, setExternalOpen] = useState(false)
  const [external, setExternal] = useState<ExternalUpdateInstructions | null>(null)
  const [sourceKind, setSourceKind] = useState<InstallSource['kind']>('managed')

  useEffect(() => {
    getVersion()
      .then(setAppVersion)
      .catch(() => setAppVersion('0.1.0'))
    getSettings()
      .then((s) => setLastPanic(s.lastPanic ?? null))
      .catch(() => {})
    getInstallSourceInfo()
      .then((i) => setSourceKind(i.source.kind))
      .catch(() => {})

    const unsubs = [
      listen<[number, number]>('cpa:download-progress', (e) => setProgress(e.payload)),
      listen('cpa:download-complete', () => {
        setDone(true)
        setDownloading(false)
        setProgress(null)
        setTimeout(() => startCpa(), 300)
      }),
      listen<string>('install:brew-line', (e) => {
        setBrewLog((prev) => prev + e.payload + '\n')
      }),
    ]
    return () => {
      unsubs.forEach((p) => p.then((fn) => fn()))
    }
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
    setError('')

    if (update.strategy === 'brewUpgrade') {
      setBrewLog('')
      setBrewOpen(true)
      try {
        await upgradeViaBrew()
        setBrewLog((prev) => prev + '\n[done]')
        setTimeout(() => startCpa(), 500)
      } catch (e) {
        setBrewLog((prev) => prev + `\n[error] ${e}`)
      }
      return
    }

    if (update.strategy === 'externalNotice') {
      try {
        setExternal(await externalUpdateInstructions())
        setExternalOpen(true)
      } catch (e) {
        setError(String(e))
      }
      return
    }

    setDownloading(true)
    setDone(false)
    try {
      if (status.kind === 'Running') await stopCpa()
      const mirrors = (await getSettings().catch(() => null))?.mirrors
      await downloadCpaUpdate(update.downloadUrl, update.latestVersion, mirrors)
    } catch (e) {
      setError(String(e))
      setDownloading(false)
    }
  }

  const updateButtonLabel = () => {
    if (!update) return ''
    if (update.strategy === 'brewUpgrade') return t.installSource.brewUpgrade
    if (update.strategy === 'externalNotice') return t.installSource.showInstructions
    return downloading ? t.about.downloading(pct) : t.about.updateTo(update.latestVersion)
  }

  const pct = progress ? Math.round((progress[0] / Math.max(progress[1], 1)) * 100) : 0

  const LINKS = [
    { label: 'CLIProxyAPI', url: 'https://github.com/router-for-me/CLIProxyAPI' },
    { label: 'Documentation', url: 'https://help.router-for.me/' },
    { label: 'CPA Desktop', url: 'https://github.com/Tendo33/CPA-Desktop' },
  ]

  return (
    <div
      className="selectable"
      style={{ height: '100%', overflowY: 'auto', background: 'var(--c-bg)', padding: '28px 28px' }}
    >
      <div style={{ maxWidth: 460, display: 'flex', flexDirection: 'column', gap: 32 }}>
        {lastPanic && (
          <section
            style={{
              padding: 12,
              borderRadius: 8,
              background: 'var(--c-err-bg)',
              border: '1px solid var(--c-err)',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            <h3
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: 'var(--c-err)',
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
              }}
            >
              Last crash
            </h3>
            <p
              style={{ fontSize: 11, color: 'var(--c-text-3)', fontVariantNumeric: 'tabular-nums' }}
            >
              {lastPanic.atIso}
            </p>
            <p style={{ fontSize: 12, color: 'var(--c-text-2)' }}>{lastPanic.message}</p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => openLogsFolder()}
              className="self-start"
            >
              Open log folder
            </Button>
          </section>
        )}

        {/* ── Identity ──────────────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Logomark */}
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 11,
              background: 'var(--c-accent-bg)',
              border: '1px solid var(--c-accent-dim)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 4,
            }}
          >
            <span
              style={{
                fontSize: 20,
                fontWeight: 700,
                color: 'var(--c-accent)',
                letterSpacing: '-0.02em',
              }}
            >
              C
            </span>
          </div>

          <div>
            <h1
              style={{
                fontSize: 20,
                fontWeight: 600,
                color: 'var(--c-text-1)',
                letterSpacing: '-0.02em',
              }}
            >
              CPA Desktop
            </h1>
            <p style={{ fontSize: 12, color: 'var(--c-text-3)', marginTop: 4 }}>
              {t.about.subtitle}
            </p>
          </div>

          <div style={{ display: 'flex', gap: 16, marginTop: 2 }}>
            <VersionChip label={t.about.appLabel} value={`v${appVersion}`} />
            {update?.currentVersion && (
              <VersionChip label={t.about.cpaLabel} value={update.currentVersion} />
            )}
          </div>
        </div>

        {/* ── CLIProxyAPI Binary ────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: 'var(--c-accent)',
            }}
          >
            {t.about.binarySection}
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
                <p style={{ fontSize: 10, color: 'var(--c-text-3)', marginBottom: 3 }}>
                  {t.about.installed}
                </p>
                <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--c-text-1)' }}>
                  {update.currentVersion ?? '—'}
                </p>
              </div>
              <div style={{ width: 1, background: 'var(--c-border-sub)', alignSelf: 'stretch' }} />
              <div>
                <p style={{ fontSize: 10, color: 'var(--c-text-3)', marginBottom: 3 }}>
                  {t.about.latest}
                </p>
                <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--c-text-1)' }}>
                  {update.latestVersion}
                </p>
              </div>
              {!update.updateAvailable && !done && (
                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center' }}>
                  <span style={{ fontSize: 11, color: 'var(--c-run)', fontWeight: 500 }}>
                    {t.about.upToDate}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Progress */}
          {downloading && progress && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div
                style={{
                  height: 3,
                  background: 'var(--c-raised)',
                  borderRadius: 999,
                  overflow: 'hidden',
                }}
              >
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
              <span style={{ fontSize: 11, color: 'var(--c-text-3)' }}>
                {t.about.downloaded(pct)}
              </span>
            </div>
          )}

          {done && (
            <p style={{ fontSize: 12, color: 'var(--c-run)', fontWeight: 500 }}>
              {t.about.updated}
            </p>
          )}

          {error && <p style={{ fontSize: 11, color: 'var(--c-err)' }}>{error}</p>}

          {/* Buttons */}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={handleCheck} disabled={checking || downloading}>
              {checking ? t.about.checking : t.about.checkUpdates}
            </Button>

            {update?.updateAvailable && !done && (
              <Button onClick={handleUpdate} disabled={downloading}>
                {updateButtonLabel()}
              </Button>
            )}
          </div>
        </div>

        <Modal
          open={brewOpen}
          onClose={() => setBrewOpen(false)}
          title="brew upgrade cliproxyapi"
        >
          <pre
            className="max-h-[320px] min-h-[120px] overflow-auto rounded bg-raised p-2 text-[11px] text-text-2 whitespace-pre-wrap break-all"
            style={{ fontFamily: 'ui-monospace, monospace' }}
          >
            {brewLog || '…'}
          </pre>
          <div className="mt-3 flex justify-end">
            <Button variant="ghost" size="sm" onClick={() => setBrewOpen(false)}>
              {t.installSource.close}
            </Button>
          </div>
        </Modal>

        <Modal
          open={externalOpen}
          onClose={() => setExternalOpen(false)}
          title={t.installSource.externalHeading[sourceKind]}
        >
          <pre
            className="rounded bg-raised p-2 text-[11px] text-text-2 whitespace-pre"
            style={{ fontFamily: 'ui-monospace, monospace' }}
          >
            {(external?.commands ?? []).join('\n')}
          </pre>
          <div className="mt-3 flex justify-between items-center">
            {external?.link && (
              <a
                href={external.link}
                target="_blank"
                rel="noreferrer"
                className="text-[11px] text-accent hover:underline"
              >
                {t.installSource.docs}
              </a>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                navigator.clipboard
                  .writeText((external?.commands ?? []).join('\n'))
                  .catch(() => {})
              }
            >
              {t.installSource.copy}
            </Button>
          </div>
        </Modal>

        {/* ── Links ─────────────────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: 'var(--c-accent)',
            }}
          >
            {t.about.links}
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
      <span
        style={{
          fontSize: 10,
          color: 'var(--c-text-3)',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          fontWeight: 600,
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 11,
          fontWeight: 500,
          color: 'var(--c-text-2)',
          background: 'var(--c-raised)',
          border: '1px solid var(--c-border)',
          borderRadius: 4,
          padding: '1px 6px',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </span>
    </div>
  )
}
