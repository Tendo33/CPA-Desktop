import { useEffect, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import {
  checkCpaUpdate,
  downloadCpaUpdate,
  getSettings,
  type UpdateCheckResult,
} from '@/lib/tauri'
import { useT } from '@/lib/i18n'
import { Button } from '@/components/ui'

interface Props {
  onDone: () => void
}

export function DownloadStep({ onDone }: Props) {
  const t = useT()
  const [update, setUpdate] = useState<UpdateCheckResult | null>(null)
  const [checking, setChecking] = useState(true)
  const [downloading, setDownloading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')
  const [mirrors, setMirrors] = useState<string[]>([])

  useEffect(() => {
    void getSettings()
      .then((s) => setMirrors(s.mirrors ?? []))
      .catch(() => {})
  }, [])

  useEffect(() => {
    checkCpaUpdate()
      .then(setUpdate)
      .catch((e) => setError(String(e)))
      .finally(() => setChecking(false))

    const unsubs = [
      listen<[number, number]>('cpa:download-progress', (e) => {
        const [dl, total] = e.payload
        setProgress(Math.round((dl / Math.max(total, 1)) * 100))
      }),
      listen('cpa:download-complete', () => onDone()),
    ]
    return () => {
      unsubs.forEach((p) => p.then((fn) => fn()))
    }
  }, [onDone])

  const handleDownload = async () => {
    if (!update) return
    setDownloading(true)
    setError('')
    setProgress(0)
    try {
      await downloadCpaUpdate(update.latestVersion, mirrors.length ? mirrors : undefined)
    } catch (e) {
      setError(String(e))
      setDownloading(false)
    }
  }

  const handleRetry = () => {
    setError('')
    setChecking(true)
    setUpdate(null)
    checkCpaUpdate()
      .then(setUpdate)
      .catch((e) => setError(String(e)))
      .finally(() => setChecking(false))
  }

  return (
    <div
      style={{
        background: 'var(--c-surface)',
        border: '1px solid var(--c-border-sub)',
        borderRadius: 10,
        padding: '20px 22px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 14,
      }}
    >
      <p
        style={{
          fontSize: 13,
          color: 'var(--c-text-3)',
          textAlign: 'center',
          lineHeight: 1.6,
          margin: 0,
        }}
      >
        {t.firstRun.description}
      </p>

      {checking && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            color: 'var(--c-text-3)',
            fontSize: 13,
          }}
        >
          <div
            style={{
              width: 14,
              height: 14,
              border: '1.5px solid var(--c-border)',
              borderTopColor: 'var(--c-accent)',
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
            }}
          />
          {t.firstRun.checkingRelease}
        </div>
      )}

      {!checking && !downloading && update && (
        <>
          <div
            style={{
              padding: '7px 14px',
              background: 'var(--c-raised)',
              border: '1px solid var(--c-border-sub)',
              borderRadius: 6,
              fontSize: 12,
              color: 'var(--c-text-3)',
            }}
          >
            {t.firstRun.latestLabel}{' '}
            <span style={{ color: 'var(--c-text-1)', fontWeight: 500 }}>
              {update.latestVersion}
            </span>
          </div>
          <Button onClick={handleDownload} size="lg" className="w-full justify-center">
            {t.firstRun.downloadBtn}
          </Button>
        </>
      )}

      {downloading && (
        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div
            style={{
              height: 3,
              background: 'var(--c-raised)',
              borderRadius: 999,
              overflow: 'hidden',
              width: '100%',
            }}
          >
            <div
              className="progress-shimmer"
              style={{
                height: '100%',
                width: `${progress}%`,
                borderRadius: 999,
                transition: 'width 200ms ease',
              }}
            />
          </div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span style={{ fontSize: 12, color: 'var(--c-text-3)' }}>
              {t.firstRun.downloading}
            </span>
            <span
              style={{
                fontSize: 12,
                color: 'var(--c-text-2)',
                fontWeight: 500,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {progress}%
            </span>
          </div>
        </div>
      )}

      {error && (
        <div
          style={{
            padding: '10px 14px',
            background: 'var(--c-err-bg)',
            border: '1px solid var(--c-err-border)',
            borderRadius: 6,
            fontSize: 12,
            color: 'var(--c-err)',
            width: '100%',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            alignItems: 'center',
          }}
        >
          <span>{error}</span>
          <Button size="sm" variant="ghost" onClick={handleRetry}>
            Retry
          </Button>
        </div>
      )}

      {!checking && !update && !error && (
        <Button size="sm" variant="ghost" onClick={handleRetry}>
          {t.firstRun.noInternet}
        </Button>
      )}
    </div>
  )
}
