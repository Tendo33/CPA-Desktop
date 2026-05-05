import { useEffect, useRef, useState } from 'react'
import { CpaWebView, type CpaWebViewHandle } from '@/components/CpaWebView'
import { useCpaStore } from '@/stores/cpa'
import {
  probeManagementApi,
  readConfigField,
  setCpaPort,
  startCpa,
  type MgmtProbeResult,
} from '@/lib/tauri'
import { errorOf, isRunning, isStarting, isError, isIdle, isStopped } from '@/lib/cpaStatus'
import { useT } from '@/lib/i18n'
import { Button } from '@/components/ui'
import { MgmtUnavailableOverlay } from '@/components/MgmtUnavailableOverlay'

export function Dashboard() {
  const { status, port } = useCpaStore()
  const webviewRef = useRef<CpaWebViewHandle>(null)
  const t = useT()

  const running = isRunning(status)
  const starting = isStarting(status)
  const error = isError(status)
  const idle = isIdle(status)
  const stopped = isStopped(status)
  const showOverlay = !running
  const errMsg = errorOf(status)
  const portInUseMatch = errMsg ? /^port_in_use:(\d+)$/.exec(errMsg) : null

  const handleRetryNextPort = async () => {
    if (!portInUseMatch) return
    const next = Number(portInUseMatch[1]) + 1
    try {
      await setCpaPort(next)
      await startCpa()
    } catch (e) {
      console.error('retry next port failed', e)
    }
  }

  const managementUrl = `http://127.0.0.1:${port}/management.html#/quota`
  const apiBase = `http://127.0.0.1:${port}`

  // Pull the latest secret-key whenever CPA enters Running so the
  // injected auto-login uses the current credentials. Re-runs on
  // restart in case the user rotated the key.
  const [secretKey, setSecretKey] = useState<string | null>(null)
  useEffect(() => {
    if (!running) return
    let cancelled = false
    void readConfigField<string>('remote-management.secret-key')
      .then((k) => {
        if (cancelled) return
        const trimmed = typeof k === 'string' ? k.trim() : ''
        setSecretKey(trimmed.length > 0 ? trimmed : null)
      })
      .catch(() => setSecretKey(null))
    return () => {
      cancelled = true
    }
  }, [running])

  // Probe the management API once CPA is Running. If it returns 401/404
  // we cover the broken webview with a self-explanatory overlay rather
  // than letting the user stare at "404 page not found" inside the
  // panel.
  const [mgmtProbe, setMgmtProbe] = useState<MgmtProbeResult | null>(null)
  // Drop the cached probe whenever CPA leaves Running so we don't show
  // a stale overlay on the next start. Computed here (not via setState
  // inside the probe effect) to keep that effect free of cascading
  // renders.
  const probeForRender = running ? mgmtProbe : null
  useEffect(() => {
    if (!running) return
    let cancelled = false
    // Small delay so the probe runs after the page boots and the auto-login
    // injection has had a chance to set localStorage. Even if it hasn't,
    // we're testing the *server*, not the browser session.
    const t = setTimeout(() => {
      void probeManagementApi()
        .then((r) => {
          if (!cancelled) setMgmtProbe(r)
        })
        .catch(() => {
          if (!cancelled) setMgmtProbe('down')
        })
    }, 800)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [running, secretKey])

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        background: 'var(--c-bg)',
        overflow: 'hidden',
      }}
    >
      <CpaWebView
        ref={webviewRef}
        url={managementUrl}
        visible={running}
        autoLogin={secretKey && mgmtProbe === 'ok' ? { apiBase, secretKey } : null}
      />

      {probeForRender && probeForRender !== 'ok' && (
        <MgmtUnavailableOverlay
          reason={probeForRender}
          onGoToSettings={() =>
            window.dispatchEvent(new CustomEvent('cpa-navigate', { detail: { page: 'settings' } }))
          }
          onReload={() => {
            setMgmtProbe(null)
            webviewRef.current?.reload()
          }}
        />
      )}

      {/* Starting overlay */}
      {starting && (
        <StateView>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              gap: 32,
              maxWidth: 480,
            }}
          >
            {/* Animated rings */}
            <div style={{ position: 'relative', width: 64, height: 64 }}>
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  border: '1.5px solid var(--c-border)',
                  borderRadius: '16px',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  border: '1.5px solid transparent',
                  borderTopColor: 'var(--c-accent)',
                  borderRightColor: 'var(--c-accent)',
                  borderRadius: '16px',
                  animation: 'spin 1.2s cubic-bezier(0.6, 0.2, 0.4, 0.8) infinite',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  inset: 14,
                  borderRadius: '8px',
                  background: 'var(--c-accent-bg)',
                }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <h1
                style={{
                  fontSize: 32,
                  fontWeight: 600,
                  color: 'var(--c-text-1)',
                  letterSpacing: 0,
                  lineHeight: 1.1,
                }}
              >
                {t.dashboard.startingCpa}
              </h1>
              <p
                style={{
                  fontSize: 15,
                  color: 'var(--c-text-3)',
                  fontVariantNumeric: 'tabular-nums',
                  lineHeight: 1.5,
                }}
              >
                {t.dashboard.waitingOn(port)}
              </p>
            </div>
          </div>
        </StateView>
      )}

      {/* Idle — binary not running */}
      {idle && !starting && (
        <StateView>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              gap: 32,
              maxWidth: 480,
            }}
          >
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: 16,
                background: 'var(--c-accent-bg)',
                border: '1px solid var(--c-accent-dim)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 8px 32px var(--c-accent-bg)',
              }}
            >
              <span
                style={{
                  fontSize: 28,
                  fontWeight: 700,
                  color: 'var(--c-accent)',
                  letterSpacing: 0,
                }}
              >
                C
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <h1
                style={{
                  fontSize: 32,
                  fontWeight: 600,
                  color: 'var(--c-text-1)',
                  letterSpacing: 0,
                  lineHeight: 1.1,
                }}
              >
                {t.dashboard.cpaNotStarted}
              </h1>
              <p style={{ fontSize: 15, color: 'var(--c-text-3)', lineHeight: 1.5 }}>
                {t.dashboard.startToOpen}
              </p>
            </div>

            <Button
              onClick={() => startCpa()}
              size="lg"
              style={{ marginTop: 8, padding: '0 24px', height: 44, fontSize: 14 }}
            >
              {t.dashboard.startCpa}
            </Button>
          </div>
        </StateView>
      )}

      {/* Stopped / Error */}
      {(stopped || error) && !starting && (
        <StateView>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              gap: 32,
              maxWidth: 520,
            }}
          >
            {/* Icon */}
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: 16,
                background: error ? 'var(--c-err-bg)' : 'var(--c-raised)',
                border: `1px solid ${error ? 'var(--c-err-border)' : 'var(--c-border)'}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 28,
                color: error ? 'var(--c-err)' : 'var(--c-text-3)',
                boxShadow: error ? '0 8px 32px var(--c-err-bg)' : 'none',
              }}
            >
              {error ? '!' : '⏹'}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <h1
                style={{
                  fontSize: 32,
                  fontWeight: 600,
                  color: 'var(--c-text-1)',
                  letterSpacing: 0,
                  lineHeight: 1.1,
                }}
              >
                {error ? t.dashboard.stoppedUnexpectedly : t.dashboard.notRunning}
              </h1>
              {error && status.kind === 'Error' && !portInUseMatch && (
                <div
                  className="selectable font-log"
                  style={{
                    fontSize: 13,
                    color: 'var(--c-err)',
                    background: 'var(--c-err-bg)',
                    padding: '12px 16px',
                    borderRadius: 8,
                    border: '1px solid var(--c-err-border)',
                    lineHeight: 1.5,
                  }}
                >
                  {status.data}
                </div>
              )}
              {portInUseMatch && (
                <div
                  className="selectable"
                  style={{
                    fontSize: 13,
                    color: 'var(--c-err)',
                    background: 'var(--c-err-bg)',
                    padding: '12px 16px',
                    borderRadius: 8,
                    border: '1px solid var(--c-err-border)',
                    lineHeight: 1.5,
                  }}
                >
                  {t.dashboard.portInUse(portInUseMatch[1])}
                </div>
              )}
            </div>

            {portInUseMatch ? (
              <Button
                onClick={handleRetryNextPort}
                size="lg"
                style={{ marginTop: 8, padding: '0 24px', height: 44, fontSize: 14 }}
              >
                {t.dashboard.tryPort(Number(portInUseMatch[1]) + 1)}
              </Button>
            ) : (
              <Button
                onClick={() => startCpa()}
                size="lg"
                style={{ marginTop: 8, padding: '0 24px', height: 44, fontSize: 14 }}
              >
                {error ? t.dashboard.restartCpa : t.dashboard.startCpa}
              </Button>
            )}
          </div>
        </StateView>
      )}

      {!showOverlay && <div style={{ width: '100%', height: '100%' }} />}
    </div>
  )
}

function StateView({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'flex-start',
        padding: '64px 48px',
        background: 'var(--c-bg)',
        zIndex: 10,
        animation: 'fade-in 240ms ease both',
      }}
    >
      {children}
    </div>
  )
}
