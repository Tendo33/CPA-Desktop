import { useRef } from 'react'
import { CpaWebView, type CpaWebViewHandle } from '@/components/CpaWebView'
import { useCpaStore } from '@/stores/cpa'
import { startCpa } from '@/lib/tauri'
import { isRunning, isStarting, isError, isIdle, isStopped } from '@/lib/cpaStatus'
import { useT } from '@/lib/i18n'

export function Dashboard() {
  const { status, port } = useCpaStore()
  const webviewRef = useRef<CpaWebViewHandle>(null)
  const t = useT()

  const running  = isRunning(status)
  const starting = isStarting(status)
  const error    = isError(status)
  const idle     = isIdle(status)
  const stopped  = isStopped(status)
  const showOverlay = !running

  const managementUrl = `http://localhost:${port}/management.html#/quota`

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: 'var(--c-bg)', overflow: 'hidden' }}>
      <CpaWebView ref={webviewRef} url={managementUrl} visible={running} />

      {/* Starting overlay */}
      {starting && (
        <Overlay>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
            {/* Animated rings */}
            <div style={{ position: 'relative', width: 48, height: 48 }}>
              <div style={{
                position: 'absolute', inset: 0,
                border: '1.5px solid var(--c-border)',
                borderRadius: '50%',
              }} />
              <div style={{
                position: 'absolute', inset: 0,
                border: '1.5px solid transparent',
                borderTopColor: 'var(--c-accent)',
                borderRadius: '50%',
                animation: 'spin 0.9s linear infinite',
              }} />
              <div style={{
                position: 'absolute', inset: 10,
                borderRadius: '50%',
                background: 'var(--c-accent-bg)',
              }} />
            </div>

            <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--c-text-1)' }}>
                {t.dashboard.startingCpa}
              </p>
              <p style={{ fontSize: 12, color: 'var(--c-text-3)', fontVariantNumeric: 'tabular-nums' }}>
                {t.dashboard.waitingOn(port)}
              </p>
            </div>
          </div>
        </Overlay>
      )}

      {/* Idle — binary not running */}
      {idle && !starting && (
        <Overlay>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24 }}>
            <div style={{
              width: 52, height: 52,
              borderRadius: 14,
              background: 'var(--c-accent-bg)',
              border: '1px solid var(--c-accent-dim)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <span style={{ fontSize: 22, fontWeight: 700, color: 'var(--c-accent)', letterSpacing: '-0.02em' }}>
                C
              </span>
            </div>

            <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--c-text-1)' }}>
                {t.dashboard.cpaNotStarted}
              </p>
              <p style={{ fontSize: 12, color: 'var(--c-text-3)', maxWidth: 260 }}>
                {t.dashboard.startToOpen}
              </p>
            </div>

            <button
              onClick={() => startCpa()}
              className="btn btn-primary"
              style={{ fontSize: 13, padding: '7px 20px' }}
            >
              {t.dashboard.startCpa}
            </button>
          </div>
        </Overlay>
      )}

      {/* Stopped / Error */}
      {(stopped || error) && !starting && (
        <Overlay>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
            {/* Icon */}
            <div style={{
              width: 52, height: 52,
              borderRadius: 14,
              background: error ? 'var(--c-err-bg)' : 'var(--c-raised)',
              border: `1px solid ${error ? 'oklch(28% 0.08 22)' : 'var(--c-border)'}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 22,
              color: error ? 'var(--c-err)' : 'var(--c-text-3)',
            }}>
              {error ? '!' : '⏹'}
            </div>

            <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--c-text-1)' }}>
                {error ? t.dashboard.stoppedUnexpectedly : t.dashboard.notRunning}
              </p>
              {error && status.kind === 'Error' && (
                <p
                  className="selectable"
                  style={{ fontSize: 11, color: 'var(--c-err)', maxWidth: 320, opacity: 0.85 }}
                >
                  {status.data}
                </p>
              )}
            </div>

            <button
              onClick={() => startCpa()}
              className="btn btn-primary"
              style={{ fontSize: 13, padding: '7px 20px' }}
            >
              {error ? t.dashboard.restartCpa : t.dashboard.startCpa}
            </button>
          </div>
        </Overlay>
      )}

      {!showOverlay && <div style={{ width: '100%', height: '100%' }} />}
    </div>
  )
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--c-bg)',
        zIndex: 10,
        animation: 'fade-in 180ms ease both',
      }}
    >
      {children}
    </div>
  )
}
