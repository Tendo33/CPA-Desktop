import { useEffect, useRef, useState } from 'react'
import { readConfigField, writeConfigField } from '@/lib/tauri'
import { Row, NumberInput, Input, Toggle } from '@/components/ui'
import { toast } from '@/stores/toast'

interface FieldState {
  port: number
  logLevel: string
  authToken: string
  authEnabled: boolean
  requestTimeout: number
}

const DEFAULTS: FieldState = {
  port: 8317,
  logLevel: 'info',
  authToken: '',
  authEnabled: false,
  requestTimeout: 60,
}

export function ConfigForm() {
  const [fields, setFields] = useState<FieldState>(DEFAULTS)
  const [loaded, setLoaded] = useState(false)
  const debounceRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      readConfigField<number>('port'),
      readConfigField<string>('log_level'),
      readConfigField<string>('auth.token'),
      readConfigField<boolean>('auth.enabled'),
      readConfigField<number>('request_timeout_seconds'),
    ]).then(([port, logLevel, authToken, authEnabled, requestTimeout]) => {
      if (cancelled) return
      setFields({
        port: typeof port === 'number' ? port : DEFAULTS.port,
        logLevel: typeof logLevel === 'string' ? logLevel : DEFAULTS.logLevel,
        authToken: typeof authToken === 'string' ? authToken : DEFAULTS.authToken,
        authEnabled: typeof authEnabled === 'boolean' ? authEnabled : DEFAULTS.authEnabled,
        requestTimeout:
          typeof requestTimeout === 'number' ? requestTimeout : DEFAULTS.requestTimeout,
      })
      setLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const writeField = (path: string, value: unknown) => {
    if (debounceRef.current[path]) clearTimeout(debounceRef.current[path])
    debounceRef.current[path] = setTimeout(async () => {
      try {
        await writeConfigField(path, value)
        toast.success('Saved')
      } catch (e) {
        toast.error(String(e))
      }
    }, 400)
  }

  const update = <K extends keyof FieldState>(key: K, value: FieldState[K], path: string) => {
    setFields((f) => ({ ...f, [key]: value }))
    writeField(path, value)
  }

  if (!loaded) {
    return <div className="text-xs text-text-3 px-3 py-4">Loading…</div>
  }

  return (
    <div>
      <Row first label="Port" hint="CPA listening port">
        <NumberInput
          value={fields.port}
          min={1024}
          max={65535}
          onChange={(n) => update('port', n, 'port')}
        />
      </Row>
      <Row label="Log level" hint="trace, debug, info, warn, error">
        <Input
          value={fields.logLevel}
          onChange={(e) => update('logLevel', e.target.value, 'log_level')}
          className="w-24"
        />
      </Row>
      <Row label="Auth enabled" hint="Require token for /v1 requests">
        <Toggle
          checked={fields.authEnabled}
          onChange={(v) => update('authEnabled', v, 'auth.enabled')}
        />
      </Row>
      <Row label="Auth token" hint="Bearer token for incoming requests">
        <Input
          value={fields.authToken}
          onChange={(e) => update('authToken', e.target.value, 'auth.token')}
          className="w-48"
        />
      </Row>
      <Row label="Request timeout (s)" hint="Upstream HTTP timeout">
        <NumberInput
          value={fields.requestTimeout}
          min={1}
          max={3600}
          onChange={(n) => update('requestTimeout', n, 'request_timeout_seconds')}
        />
      </Row>
    </div>
  )
}
