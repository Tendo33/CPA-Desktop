import { useT } from '@/lib/i18n'
import { Button, PasswordInput } from '@/components/ui'

interface Props {
  credentials: { secretKey: string; apiKeys: string[] }
  onContinue: () => void
}

export function DoneStep({ credentials, onContinue }: Props) {
  const t = useT()
  return (
    <div
      style={{
        background: 'var(--c-surface)',
        border: '1px solid var(--c-border-sub)',
        borderRadius: 10,
        padding: '20px 22px',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <h2
          style={{
            fontSize: 16,
            fontWeight: 600,
            color: 'var(--c-text-1)',
            margin: 0,
            letterSpacing: '-0.015em',
          }}
        >
          {t.setup.doneTitle}
        </h2>
        <p style={{ fontSize: 12, color: 'var(--c-text-3)', margin: 0, lineHeight: 1.55 }}>
          {t.setup.doneSubtitle}
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label
          style={{
            fontSize: 11,
            color: 'var(--c-text-3)',
            fontWeight: 500,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          {t.setup.secretLabel}
        </label>
        <PasswordInput value={credentials.secretKey} readOnly wrapperClassName="w-full" />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label
          style={{
            fontSize: 11,
            color: 'var(--c-text-3)',
            fontWeight: 500,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          {t.setup.apiKeysLabel}
        </label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {credentials.apiKeys.map((k, i) => (
            <PasswordInput key={i} value={k} readOnly wrapperClassName="w-full" />
          ))}
        </div>
      </div>

      <div
        style={{
          padding: '8px 12px',
          borderRadius: 6,
          background: 'var(--c-accent-bg)',
          border: '1px solid var(--c-accent-dim)',
          fontSize: 11,
          color: 'var(--c-text-2)',
          lineHeight: 1.55,
        }}
      >
        ⚑ {t.setup.copyWarning}
      </div>

      <Button
        onClick={onContinue}
        size="lg"
        className="w-full justify-center"
        style={{ marginTop: 4 }}
      >
        {t.setup.doneCta}
      </Button>
      <p
        style={{
          fontSize: 11,
          color: 'var(--c-text-3)',
          textAlign: 'center',
          margin: 0,
        }}
      >
        {t.setup.autoLoginNote}
      </p>
    </div>
  )
}
