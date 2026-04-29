import { useState } from 'react'
import { useT } from '@/lib/i18n'
import { Button, NumberInput, Row, Toggle } from '@/components/ui'

interface Props {
  defaultPort: number
  defaultAutoStart: boolean
  onSubmit: (port: number, autoStart: boolean) => void | Promise<void>
}

export function ConfigureStep({ defaultPort, defaultAutoStart, onSubmit }: Props) {
  const t = useT()
  const [port, setPort] = useState(defaultPort)
  const [autoStart, setAutoStart] = useState(defaultAutoStart)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async () => {
    if (submitting) return
    setSubmitting(true)
    try {
      await onSubmit(port, autoStart)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      style={{
        background: 'var(--c-surface)',
        border: '1px solid var(--c-border-sub)',
        borderRadius: 10,
        padding: '6px 22px 18px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <Row first label={t.setup.portLabel} hint={t.setup.portHint}>
        <NumberInput value={port} min={1024} max={65535} onChange={setPort} />
      </Row>

      <Row label={t.settings.autoStartCpa} hint={t.settings.autoStartHint}>
        <Toggle checked={autoStart} onChange={setAutoStart} />
      </Row>

      <p
        style={{
          fontSize: 11,
          color: 'var(--c-text-3)',
          margin: '6px 0 0',
          lineHeight: 1.5,
        }}
      >
        {t.setup.secretHint} {t.setup.apiKeysHint}
      </p>

      <Button
        onClick={handleSubmit}
        size="lg"
        className="w-full justify-center"
        disabled={submitting}
        style={{ marginTop: 10 }}
      >
        {submitting ? t.setup.initializing : t.setup.actionInitialize}
      </Button>
    </div>
  )
}
