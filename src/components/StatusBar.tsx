import { useCpaStore } from '@/stores/cpa'
import { startCpa, stopCpa } from '@/lib/tauri'
import type { CpaStatus } from '@/lib/tauri'
import { errorOf, isRunning, isStarting } from '@/lib/cpaStatus'
import { useT } from '@/lib/i18n'
import { dotClass, statusColor } from '@/components/statusbar.helpers'

export function StatusBar() {
  const { status, port } = useCpaStore()
  const t = useT()
  const running  = isRunning(status)
  const starting = isStarting(status)
  const errorMsg = errorOf(status)

  function statusText(s: CpaStatus): string {
    switch (s.kind) {
      case 'Running':  return t.status.running
      case 'Starting': return t.status.starting
      case 'Stopped':  return t.status.stopped
      case 'Idle':     return t.status.notStarted
      case 'Error':    return t.status.error
    }
  }

  return (
    <div
      style={{
        height: 26,
        background: 'var(--c-surface)',
        borderTop: '1px solid var(--c-border-sub)',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '0 12px',
        flexShrink: 0,
      }}
    >
      {/* Status pill */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <span className={dotClass(status)} />
        <span
          style={{
            fontSize: 11,
            fontWeight: 500,
            color: statusColor(status),
            letterSpacing: '0.01em',
          }}
        >
          {statusText(status)}
        </span>
        {errorMsg && (
          <span
            style={{
              fontSize: 11,
              color: 'var(--c-err)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: 240,
              opacity: 0.8,
            }}
            title={errorMsg}
          >
            — {errorMsg}
          </span>
        )}
      </div>

      {/* Port */}
      <div
        style={{
          fontSize: 11,
          color: 'var(--c-text-3)',
          fontVariantNumeric: 'tabular-nums',
          marginLeft: 4,
        }}
      >
        :{port}
      </div>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Start / Stop */}
      <button
        onClick={() => (running || starting ? stopCpa() : startCpa())}
        disabled={starting}
        style={{
          fontSize: 11,
          fontWeight: 500,
          fontFamily: 'inherit',
          padding: '1px 8px',
          borderRadius: 4,
          border: '1px solid',
          cursor: starting ? 'default' : 'pointer',
          transition: 'background 130ms ease, color 130ms ease',
          ...(running
            ? {
                background: 'transparent',
                borderColor: 'var(--c-border)',
                color: 'var(--c-text-3)',
              }
            : {
                background: 'var(--c-accent-bg)',
                borderColor: 'var(--c-accent-dim)',
                color: 'var(--c-accent)',
              }),
        }}
        onMouseEnter={(e) => {
          if (starting) return
          if (running) {
            e.currentTarget.style.background = 'var(--c-err-bg)'
            e.currentTarget.style.borderColor = 'oklch(28% 0.07 22)'
            e.currentTarget.style.color = 'var(--c-err)'
          } else {
            e.currentTarget.style.background = 'oklch(20% 0.045 58)'
            e.currentTarget.style.borderColor = 'var(--c-accent)'
          }
        }}
        onMouseLeave={(e) => {
          if (starting) return
          if (running) {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.borderColor = 'var(--c-border)'
            e.currentTarget.style.color = 'var(--c-text-3)'
          } else {
            e.currentTarget.style.background = 'var(--c-accent-bg)'
            e.currentTarget.style.borderColor = 'var(--c-accent-dim)'
            e.currentTarget.style.color = 'var(--c-accent)'
          }
        }}
      >
        {running ? t.status.stop : starting ? t.status.startingEllipsis : t.status.start}
      </button>
    </div>
  )
}
