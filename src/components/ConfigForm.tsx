import { useEffect, useRef, useState } from 'react'
import { readConfigField, writeConfigField, generateSecret } from '@/lib/tauri'
import {
  Row,
  NumberInput,
  Input,
  Toggle,
  PasswordInput,
  ApiKeyList,
  Modal,
  Button,
} from '@/components/ui'
import { toast } from '@/stores/toast'
import { useT } from '@/lib/i18n'

interface FieldState {
  port: number
  host: string
  debug: boolean
  secretKey: string
  apiKeys: string[]
  requestRetry: number
}

const DEFAULTS: FieldState = {
  port: 8317,
  host: '',
  debug: false,
  secretKey: '',
  apiKeys: [],
  requestRetry: 3,
}

/**
 * Field paths follow CPA's actual config.yaml schema. Note the dashed keys
 * (`remote-management.secret-key`, `api-keys`); the backend `set_path`
 * helper splits on `.` and treats each segment literally, so dashes are
 * preserved.
 */
const PATHS = {
  port: 'port',
  host: 'host',
  debug: 'debug',
  secretKey: 'remote-management.secret-key',
  apiKeys: 'api-keys',
  requestRetry: 'request-retry',
} as const

interface DirtyState {
  /** Fields that require a CPA restart to take effect. */
  needsRestart: boolean
}

/**
 * Notify Settings (or any other consumer) when a "needs restart" field
 * changes. We use a window event because ConfigForm is rendered as a
 * child of Settings and we don't want to thread props through.
 */
function notifyDirty(state: DirtyState) {
  window.dispatchEvent(new CustomEvent('cpa-config-dirty', { detail: state }))
}

const RESTART_REQUIRED_KEYS = new Set<keyof FieldState>([
  'port',
  'host',
  'secretKey',
  'apiKeys',
])

export function ConfigForm() {
  const t = useT()
  const [fields, setFields] = useState<FieldState>(DEFAULTS)
  const [loaded, setLoaded] = useState(false)
  const [resetConfirm, setResetConfirm] = useState(false)
  const debounceRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const pendingToast = useRef<ReturnType<typeof setTimeout> | null>(null)
  const writesInFlight = useRef(0)

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      readConfigField<number>(PATHS.port),
      readConfigField<string>(PATHS.host),
      readConfigField<boolean>(PATHS.debug),
      readConfigField<string>(PATHS.secretKey),
      readConfigField<string[]>(PATHS.apiKeys),
      readConfigField<number>(PATHS.requestRetry),
    ]).then(([port, host, debug, secretKey, apiKeys, requestRetry]) => {
      if (cancelled) return
      setFields({
        port: typeof port === 'number' ? port : DEFAULTS.port,
        host: typeof host === 'string' ? host : DEFAULTS.host,
        debug: typeof debug === 'boolean' ? debug : DEFAULTS.debug,
        secretKey: typeof secretKey === 'string' ? secretKey : DEFAULTS.secretKey,
        apiKeys: Array.isArray(apiKeys)
          ? apiKeys.filter((k): k is string => typeof k === 'string')
          : DEFAULTS.apiKeys,
        requestRetry: typeof requestRetry === 'number' ? requestRetry : DEFAULTS.requestRetry,
      })
      setLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const flashSavedOnce = () => {
    if (pendingToast.current) clearTimeout(pendingToast.current)
    pendingToast.current = setTimeout(() => {
      pendingToast.current = null
      if (writesInFlight.current === 0) {
        toast.success('Saved')
      }
    }, 700)
  }

  const writeField = (path: string, value: unknown, requiresRestart: boolean) => {
    if (debounceRef.current[path]) clearTimeout(debounceRef.current[path])
    debounceRef.current[path] = setTimeout(async () => {
      writesInFlight.current += 1
      try {
        await writeConfigField(path, value)
        if (requiresRestart) notifyDirty({ needsRestart: true })
        flashSavedOnce()
      } catch (e) {
        toast.error(String(e))
      } finally {
        writesInFlight.current -= 1
      }
    }, 400)
  }

  const update = <K extends keyof FieldState>(key: K, value: FieldState[K]) => {
    setFields((f) => ({ ...f, [key]: value }))
    writeField(PATHS[key], value, RESTART_REQUIRED_KEYS.has(key))
  }

  const handleRegenerateSecret = () => setResetConfirm(true)

  const performResetSecret = async () => {
    setResetConfirm(false)
    try {
      const k = await generateSecret()
      update('secretKey', k)
      toast.success('New secret generated. Copy it before you leave this page.')
    } catch (e) {
      toast.error(`Generate failed: ${String(e)}`)
    }
  }

  if (!loaded) {
    return <div className="text-xs text-text-3 px-3 py-4">Loading…</div>
  }

  return (
    <div>
      <Row first label="Port" hint="CPA listening port (restart required)">
        <NumberInput
          value={fields.port}
          min={1024}
          max={65535}
          onChange={(n) => update('port', n)}
        />
      </Row>
      <Row label="Host" hint='Empty = bind all interfaces. Use "127.0.0.1" for localhost only.'>
        <Input
          value={fields.host}
          onChange={(e) => update('host', e.target.value)}
          placeholder="(all interfaces)"
          className="w-48"
        />
      </Row>
      <Row label="Debug logging" hint="Verbose CPA logs (restart required)">
        <Toggle checked={fields.debug} onChange={(v) => update('debug', v)} />
      </Row>
      <Row
        label="Management secret key"
        hint="Required to access /v0/management. Empty disables the management API entirely."
      >
        <PasswordInput
          value={fields.secretKey}
          onChange={(e) => update('secretKey', e.target.value)}
          onRegenerate={handleRegenerateSecret}
          wrapperClassName="w-72"
          placeholder="(disabled)"
        />
      </Row>
      <Row label="Client API keys" hint="Bearer tokens callers send to /v1/* (restart required)">
        <ApiKeyList value={fields.apiKeys} onChange={(v) => update('apiKeys', v)} />
      </Row>
      <Row label="Request retry" hint="Retries on 403/408/5xx upstream responses">
        <NumberInput
          value={fields.requestRetry}
          min={0}
          max={10}
          onChange={(n) => update('requestRetry', n)}
        />
      </Row>

      <Modal
        open={resetConfirm}
        onClose={() => setResetConfirm(false)}
        title={t.settings.resetSecretConfirmTitle}
      >
        <p
          style={{
            fontSize: 12,
            color: 'var(--c-text-3)',
            lineHeight: 1.55,
            marginBottom: 12,
          }}
        >
          {t.settings.resetSecretConfirmBody}
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
          <Button variant="ghost" size="sm" onClick={() => setResetConfirm(false)}>
            {t.installSource.cancel}
          </Button>
          <Button size="sm" onClick={performResetSecret}>
            {t.settings.resetSecretCta}
          </Button>
        </div>
      </Modal>
    </div>
  )
}
