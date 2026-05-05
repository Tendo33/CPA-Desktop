import { useEffect, useRef, useState } from 'react'
import { readConfigField, writeConfigField, generateSecret, setCpaPort } from '@/lib/tauri'
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

const RESTART_REQUIRED_KEYS = new Set<keyof FieldState>(['port', 'host', 'secretKey', 'apiKeys'])

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
        toast.success(t.configForm.saved)
      }
    }, 700)
  }

  const writeField = (path: string, value: unknown, requiresRestart: boolean) => {
    if (debounceRef.current[path]) clearTimeout(debounceRef.current[path])
    debounceRef.current[path] = setTimeout(async () => {
      writesInFlight.current += 1
      try {
        if (path === PATHS.port) {
          await setCpaPort(Number(value))
        } else {
          await writeConfigField(path, value)
        }
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
      toast.success(t.configForm.newSecretGenerated)
    } catch (e) {
      toast.error(t.common.generateFailed(String(e)))
    }
  }

  if (!loaded) {
    return <div className="text-xs text-text-3 px-4 py-5">{t.configForm.loading}</div>
  }

  return (
    <div>
      <Row first label={t.configForm.port} hint={t.configForm.portHint}>
        <NumberInput
          aria-label={t.configForm.port}
          value={fields.port}
          min={1024}
          max={65535}
          onChange={(n) => update('port', n)}
        />
      </Row>
      <Row label={t.configForm.host} hint={t.configForm.hostHint}>
        <Input
          aria-label={t.configForm.host}
          value={fields.host}
          onChange={(e) => update('host', e.target.value)}
          placeholder={t.configForm.hostPlaceholder}
          className="w-56"
        />
      </Row>
      <Row label={t.configForm.debug} hint={t.configForm.debugHint}>
        <Toggle
          checked={fields.debug}
          onChange={(v) => update('debug', v)}
          ariaLabel={t.configForm.debug}
        />
      </Row>
      <Row
        label={t.configForm.secretKey}
        hint={t.configForm.secretKeyHint}
        controlClassName="w-auto"
      >
        <PasswordInput
          aria-label={t.configForm.secretKey}
          value={fields.secretKey}
          onChange={(e) => update('secretKey', e.target.value)}
          onRegenerate={handleRegenerateSecret}
          wrapperClassName="w-80"
          placeholder={t.configForm.secretPlaceholder}
        />
      </Row>
      <Row
        label={t.configForm.clientApiKeys}
        hint={t.configForm.clientApiKeysHint}
        controlClassName="w-[420px] max-w-full"
      >
        <ApiKeyList value={fields.apiKeys} onChange={(v) => update('apiKeys', v)} />
      </Row>
      <Row label={t.configForm.requestRetry} hint={t.configForm.requestRetryHint}>
        <NumberInput
          aria-label={t.configForm.requestRetry}
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
