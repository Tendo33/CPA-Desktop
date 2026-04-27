import { useEffect, useState } from 'react'
import {
  getSettings,
  saveSettings,
  readConfigYaml,
  writeConfigYaml,
  openDataDir,
  stopCpa,
  startCpa,
  getPortFromYaml,
  getAutolaunchEnabled,
  setAutolaunchEnabled,
  type AppSettings,
} from '@/lib/tauri'
import { useCpaStore } from '@/stores/cpa'
import { FolderOpen, RefreshCw } from 'lucide-react'
import { useT } from '@/lib/i18n'

/* ── Toggle Switch ─────────────────────────────────────────────────────── */
function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      className={`toggle${checked ? ' on' : ''}`}
      style={{ opacity: disabled ? 0.4 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }}
      onClick={() => !disabled && onChange(!checked)}
      aria-checked={checked}
      role="switch"
    >
      <span className="toggle-thumb" />
    </button>
  )
}

/* ── Section wrapper ───────────────────────────────────────────────────── */
function Section({
  title,
  action,
  children,
}: {
  title: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 2,
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: 'var(--c-accent)',
          }}
        >
          {title}
        </span>
        {action}
      </div>
      <div style={{ border: '1px solid var(--c-border-sub)', borderRadius: 8, overflow: 'hidden' }}>
        {children}
      </div>
    </section>
  )
}

/* ── Setting row ───────────────────────────────────────────────────────── */
function Row({
  label,
  hint,
  children,
  first,
}: {
  label: string
  hint?: string
  children: React.ReactNode
  first?: boolean
}) {
  return (
    <div
      className="setting-row"
      style={{
        padding: '11px 14px',
        borderTop: first ? 'none' : '1px solid var(--c-border-sub)',
        background: 'var(--c-surface)',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--c-text-1)' }}>{label}</span>
        {hint && <span style={{ fontSize: 11, color: 'var(--c-text-3)' }}>{hint}</span>}
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  )
}

/* ── Main page ─────────────────────────────────────────────────────────── */
export function SettingsPage() {
  const { status } = useCpaStore()
  const t = useT()
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [yaml, setYaml]         = useState('')
  const [saving, setSaving]     = useState(false)
  const [yamlError, setYamlError] = useState('')
  const [msg, setMsg]           = useState('')
  const [autolaunch, setAutolaunch] = useState(false)
  const [yamlPort, setYamlPort] = useState<number | null>(null)

  useEffect(() => {
    getSettings().then(setSettings)
    readConfigYaml().then(setYaml).catch(() => {})
    getAutolaunchEnabled().then(setAutolaunch).catch(() => {})
    getPortFromYaml().then(setYamlPort).catch(() => {})
  }, [])

  const flash = (m: string) => {
    setMsg(m)
    setTimeout(() => setMsg(''), 2500)
  }

  const handleAutolaunchChange = async (checked: boolean) => {
    try {
      await setAutolaunchEnabled(checked)
      setAutolaunch(checked)
      flash(checked ? t.settings.loginEnabled : t.settings.loginDisabled)
    } catch (e) {
      flash(`Error: ${e}`)
    }
  }

  const handleSaveSettings = async () => {
    if (!settings) return
    setSaving(true)
    try {
      await saveSettings(settings)
      flash(t.settings.savedMsg)
    } catch (e) {
      flash(String(e))
    }
    setSaving(false)
  }

  const handleSaveYaml = async () => {
    setYamlError('')
    setSaving(true)
    try {
      await writeConfigYaml(yaml)
      flash(t.settings.configSaved)
    } catch (e) {
      setYamlError(String(e))
    }
    setSaving(false)
  }

  const handleRestartCpa = async () => {
    if (status.kind === 'Running') await stopCpa()
    setTimeout(() => startCpa(), 500)
  }

  if (!settings) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--c-text-3)', fontSize: 12 }}>
        {t.settings.loading}
      </div>
    )
  }

  const portMismatch = yamlPort !== null && yamlPort !== settings.port

  return (
    <div
      className="selectable"
      style={{ height: '100%', overflowY: 'auto', background: 'var(--c-bg)', padding: '24px 28px' }}
    >
      <div style={{ maxWidth: 520, display: 'flex', flexDirection: 'column', gap: 28 }}>

        {/* ── Application ─────────────────────────────────────────── */}
        <Section title={t.settings.application}>
          <Row first label={t.settings.cpaPort} hint={portMismatch ? t.settings.portMismatch(yamlPort!) : t.settings.portHint}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {portMismatch && (
                <span style={{ fontSize: 10, color: 'var(--c-start)', fontWeight: 500 }}>{t.settings.mismatch}</span>
              )}
              <input
                type="number"
                value={settings.port}
                min={1024}
                max={65535}
                onChange={(e) => setSettings({ ...settings, port: Number(e.target.value) })}
                style={{
                  width: 72,
                  height: 26,
                  background: 'var(--c-raised)',
                  border: '1px solid var(--c-border)',
                  borderRadius: 5,
                  padding: '0 8px',
                  fontSize: 12,
                  fontFamily: 'inherit',
                  color: 'var(--c-text-1)',
                  textAlign: 'right',
                  outline: 'none',
                  fontVariantNumeric: 'tabular-nums',
                }}
                onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--c-accent-dim)')}
                onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--c-border)')}
              />
            </div>
          </Row>

          <Row label={t.settings.autoStartCpa} hint={t.settings.autoStartHint}>
            <Toggle
              checked={settings.autoStart}
              onChange={(v) => setSettings({ ...settings, autoStart: v })}
            />
          </Row>

          <Row label={t.settings.launchOnLogin} hint={t.settings.launchOnLoginHint}>
            <Toggle checked={autolaunch} onChange={handleAutolaunchChange} />
          </Row>
        </Section>

        {/* ── Actions ─────────────────────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button
            onClick={handleSaveSettings}
            disabled={saving}
            className="btn btn-primary"
          >
            {saving ? t.settings.saving : t.settings.saveSettings}
          </button>

          <button onClick={openDataDir} className="btn btn-ghost">
            <FolderOpen size={12} strokeWidth={1.75} />
            {t.settings.dataFolder}
          </button>

          <button onClick={handleRestartCpa} className="btn btn-ghost">
            <RefreshCw size={12} strokeWidth={1.75} />
            {t.settings.restartCpa}
          </button>

          {msg && (
            <span style={{ fontSize: 12, color: 'var(--c-run)', fontWeight: 500 }}>
              {msg}
            </span>
          )}
        </div>

        {/* ── config.yaml ─────────────────────────────────────────── */}
        <Section
          title={t.settings.configYaml}
          action={
            <button
              onClick={handleSaveYaml}
              disabled={saving}
              className="btn btn-primary"
              style={{ fontSize: 11, padding: '3px 10px' }}
            >
              {t.settings.saveApply}
            </button>
          }
        >
          <div style={{ background: 'var(--c-surface)', padding: '2px 0' }}>
            {yamlError && (
              <div
                style={{
                  padding: '8px 12px',
                  borderBottom: '1px solid oklch(28% 0.08 22)',
                  background: 'var(--c-err-bg)',
                  fontSize: 11,
                  color: 'var(--c-err)',
                }}
              >
                {yamlError}
              </div>
            )}
            <textarea
              value={yaml}
              onChange={(e) => setYaml(e.target.value)}
              spellCheck={false}
              className="font-log"
              style={{
                width: '100%',
                height: 320,
                background: 'transparent',
                border: 'none',
                padding: '12px 14px',
                fontSize: 11,
                color: 'var(--c-text-2)',
                resize: 'vertical',
                outline: 'none',
                lineHeight: 1.7,
                display: 'block',
              }}
            />
          </div>
        </Section>

        <p style={{ fontSize: 11, color: 'var(--c-text-3)' }}>
          {t.settings.restartNote}
        </p>
      </div>
    </div>
  )
}
