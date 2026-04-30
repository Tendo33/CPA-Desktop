import { useT } from '@/lib/i18n'
import { Button } from '@/components/ui'
import type { MgmtProbeResult } from '@/lib/tauri'

interface Props {
  reason: Exclude<MgmtProbeResult, 'ok'>
  onGoToSettings: () => void
  onReload: () => void
}

/**
 * Shown over the Dashboard when the embedded management panel can't
 * authenticate (typical: secret-key empty → 404, or rotated → 401).
 *
 * "down" is also handled by this overlay because if the management API
 * is unreachable while CPA reports Running, the user needs an explicit
 * cue rather than a blank webview.
 */
export function MgmtUnavailableOverlay({ reason, onGoToSettings, onReload }: Props) {
  const t = useT()
  const isNoKey = reason === 'noKey'
  const title = isNoKey ? t.mgmtUnavailable.titleNoKey : t.mgmtUnavailable.titleUnauthorized
  const body = isNoKey ? t.mgmtUnavailable.bodyNoKey : t.mgmtUnavailable.bodyUnauthorized
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
        zIndex: 20,
        animation: 'fade-in 200ms ease both',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          gap: 24,
          maxWidth: 520,
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 14,
            background: 'var(--c-err-bg)',
            border: '1px solid var(--c-err-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--c-err)',
            fontSize: 24,
            fontWeight: 600,
          }}
        >
          !
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h2
            style={{
              fontSize: 24,
              fontWeight: 600,
              color: 'var(--c-text-1)',
              letterSpacing: 0,
              lineHeight: 1.15,
              margin: 0,
            }}
          >
            {title}
          </h2>
          <p
            style={{
              fontSize: 14,
              color: 'var(--c-text-3)',
              lineHeight: 1.55,
              margin: 0,
              maxWidth: 460,
            }}
          >
            {body}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button onClick={onGoToSettings}>{t.mgmtUnavailable.goToSettings}</Button>
          <Button variant="ghost" onClick={onReload}>
            {t.mgmtUnavailable.reload}
          </Button>
        </div>
      </div>
    </div>
  )
}
