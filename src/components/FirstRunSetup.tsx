import { useState, useEffect } from 'react'
import { checkCpaUpdate, downloadCpaUpdate, type UpdateCheckResult } from '@/lib/tauri'
import { listen } from '@tauri-apps/api/event'
import { useT } from '@/lib/i18n'
import { Button } from '@/components/ui'

interface Props {
  onComplete: () => void
}

export function FirstRunSetup({ onComplete }: Props) {
  const t = useT()
  const [update, setUpdate]         = useState<UpdateCheckResult | null>(null)
  const [checking, setChecking]     = useState(true)
  const [downloading, setDownloading] = useState(false)
  const [progress, setProgress]     = useState(0)
  const [error, setError]           = useState('')

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
      listen('cpa:download-complete', () => onComplete()),
    ]
    return () => { unsubs.forEach((p) => p.then((fn) => fn())) }
  }, [onComplete])

  const handleDownload = async () => {
    if (!update) return
    setDownloading(true)
    setError('')
    try {
      await downloadCpaUpdate(update.downloadUrl, update.latestVersion)
    } catch (e) {
      setError(String(e))
      setDownloading(false)
    }
  }

  return (
    <div
      style={{
        height: '100vh',
        background: 'var(--c-bg)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 40,
        animation: 'fade-in 300ms ease both',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 0,
          maxWidth: 340,
          width: '100%',
          animation: 'fade-up 380ms cubic-bezier(0.22, 1, 0.36, 1) both',
        }}
      >
        {/* Logotype mark */}
        <div style={{
          width: 60, height: 60,
          borderRadius: 16,
          background: 'var(--c-accent-bg)',
          border: '1px solid var(--c-accent-dim)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginBottom: 24,
        }}>
          <span style={{
            fontSize: 26,
            fontWeight: 700,
            color: 'var(--c-accent)',
            letterSpacing: '-0.03em',
          }}>
            C
          </span>
        </div>

        {/* Heading */}
        <h1 style={{
          fontSize: 22,
          fontWeight: 600,
          color: 'var(--c-text-1)',
          letterSpacing: '-0.025em',
          textAlign: 'center',
          marginBottom: 10,
        }}>
          CPA Desktop
        </h1>

        <p style={{
          fontSize: 13,
          color: 'var(--c-text-3)',
          textAlign: 'center',
          lineHeight: 1.6,
          marginBottom: 32,
          maxWidth: 280,
        }}>
          {t.firstRun.description}
        </p>

        {/* States */}
        {checking && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--c-text-3)', fontSize: 13 }}>
            <div style={{
              width: 14, height: 14,
              border: '1.5px solid var(--c-border)',
              borderTopColor: 'var(--c-accent)',
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
              flexShrink: 0,
            }} />
            {t.firstRun.checkingRelease}
          </div>
        )}

        {!checking && !downloading && update && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, width: '100%' }}>
            <div style={{
              padding: '7px 14px',
              background: 'var(--c-surface)',
              border: '1px solid var(--c-border-sub)',
              borderRadius: 6,
              fontSize: 12,
              color: 'var(--c-text-3)',
            }}>
              {t.firstRun.latestLabel}{' '}
              <span style={{ color: 'var(--c-text-1)', fontWeight: 500 }}>
                {update.latestVersion}
              </span>
            </div>

            <Button onClick={handleDownload} size="lg" className="w-full justify-center">
              {t.firstRun.downloadBtn}
            </Button>
          </div>
        )}

        {downloading && (
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {/* Progress bar */}
            <div style={{
              height: 3,
              background: 'var(--c-raised)',
              borderRadius: 999,
              overflow: 'hidden',
              width: '100%',
            }}>
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

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--c-text-3)' }}>{t.firstRun.downloading}</span>
              <span style={{ fontSize: 12, color: 'var(--c-text-2)', fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
                {progress}%
              </span>
            </div>
          </div>
        )}

        {error && (
          <div style={{
            padding: '10px 14px',
            background: 'var(--c-err-bg)',
            border: '1px solid oklch(28% 0.08 22)',
            borderRadius: 6,
            fontSize: 12,
            color: 'var(--c-err)',
            width: '100%',
            textAlign: 'center',
          }}>
            {error}
          </div>
        )}

        {!checking && !update && !error && (
          <p style={{ fontSize: 12, color: 'var(--c-text-3)', textAlign: 'center' }}>
            {t.firstRun.noInternet}
          </p>
        )}
      </div>
    </div>
  )
}
