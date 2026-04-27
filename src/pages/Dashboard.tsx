import { useRef } from 'react'
import { CpaWebView, type CpaWebViewHandle } from '@/components/CpaWebView'
import { useCpaStore } from '@/stores/cpa'
import { startCpa } from '@/lib/tauri'

export function Dashboard() {
  const { status, port } = useCpaStore()
  const webviewRef = useRef<CpaWebViewHandle>(null)

  const isRunning  = status === 'Running'
  const isStarting = status === 'Starting'
  const isError    = typeof status === 'object'
  const isIdle     = status === 'Idle'
  const isStopped  = status === 'Stopped'
  const showOverlay = !isRunning

  const managementUrl = `http://localhost:${port}/management.html#/quota`

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: 'var(--c-bg)', overflow: 'hidden' }}>
      <CpaWebView ref={webviewRef} url={managementUrl} visible={isRunning} />

      {/* Starting overlay */}
      {isStarting && (
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
                Starting CPA
              </p>
              <p style={{ fontSize: 12, color: 'var(--c-text-3)', fontVariantNumeric: 'tabular-nums' }}>
                Waiting on localhost:{port}
              </p>
            </div>
          </div>
        </Overlay>
      )}

      {/* Idle — binary not running */}
      {isIdle && !isStarting && (
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
                CPA not started
              </p>
              <p style={{ fontSize: 12, color: 'var(--c-text-3)', maxWidth: 260 }}>
                Start CPA to open the management dashboard
              </p>
            </div>

            <button
              onClick={() => startCpa()}
              className="btn btn-primary"
              style={{ fontSize: 13, padding: '7px 20px' }}
            >
              Start CPA
            </button>
          </div>
        </Overlay>
      )}

      {/* Stopped / Error */}
      {(isStopped || isError) && !isStarting && (
        <Overlay>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
            {/* Icon */}
            <div style={{
              width: 52, height: 52,
              borderRadius: 14,
              background: isError ? 'var(--c-err-bg)' : 'var(--c-raised)',
              border: `1px solid ${isError ? 'oklch(28% 0.08 22)' : 'var(--c-border)'}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 22,
              color: isError ? 'var(--c-err)' : 'var(--c-text-3)',
            }}>
              {isError ? '!' : '⏹'}
            </div>

            <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--c-text-1)' }}>
                {isError ? 'CPA stopped unexpectedly' : 'CPA is not running'}
              </p>
              {isError && (
                <p
                  className="selectable"
                  style={{ fontSize: 11, color: 'var(--c-err)', maxWidth: 320, opacity: 0.85 }}
                >
                  {(status as { error: string }).error}
                </p>
              )}
            </div>

            <button
              onClick={() => startCpa()}
              className="btn btn-primary"
              style={{ fontSize: 13, padding: '7px 20px' }}
            >
              {isError ? 'Restart CPA' : 'Start CPA'}
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
