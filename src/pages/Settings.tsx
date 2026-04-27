import { lazy, Suspense, useEffect, useState } from 'react'
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
  checkAppUpdate,
  applyAppUpdate,
  type AppSettings,
} from '@/lib/tauri'
import { useCpaStore } from '@/stores/cpa'
import { FolderOpen, RefreshCw } from 'lucide-react'
import { useT } from '@/lib/i18n'
import { Button, Input, NumberInput, Row, Section, Toggle } from '@/components/ui'
import { ConfigForm } from '@/components/ConfigForm'
import { cn } from '@/lib/utils'
import { useSettingsStore } from '@/stores/settings'

const MonacoEditor = lazy(() =>
  import('@monaco-editor/react').then((m) => ({ default: m.default })),
)

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
  const [updateMsg, setUpdateMsg] = useState('')
  const [configTab, setConfigTab] = useState<'form' | 'yaml'>('form')
  const theme = useSettingsStore((s) => s.theme)

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

  const onCheckUpdate = async () => {
    setUpdateMsg('Checking…')
    try {
      const u = await checkAppUpdate()
      if (!u) {
        setUpdateMsg('Up to date')
        return
      }
      if (confirm(`Update ${u.version} available. Install now?`)) {
        setUpdateMsg('Downloading…')
        await applyAppUpdate(u)
      } else {
        setUpdateMsg(`v${u.version} available`)
      }
    } catch (e) {
      setUpdateMsg(String(e))
    }
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
              <NumberInput
                value={settings.port}
                min={1024}
                max={65535}
                onChange={(n) => setSettings({ ...settings, port: n })}
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

          <Row label="Check for app updates" hint={updateMsg || 'Tauri self-updater'}>
            <Button variant="ghost" size="sm" onClick={onCheckUpdate}>Check now</Button>
          </Row>

          <Row label="Auto-check on launch" hint="Once every 6 hours">
            <Toggle
              checked={settings.autoCheckAppUpdates ?? false}
              onChange={(v) => setSettings({ ...settings, autoCheckAppUpdates: v })}
            />
          </Row>

          <Row
            label="Download mirrors"
            hint="Comma-separated host list, tried in order"
          >
            <Input
              value={(settings.mirrors ?? []).join(', ')}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  mirrors: e.target.value
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
              className="w-72"
            />
          </Row>
        </Section>

        {/* ── Actions ─────────────────────────────────────────────── */}
        <div className="flex items-center gap-2 flex-wrap">
          <Button onClick={handleSaveSettings} disabled={saving}>
            {saving ? t.settings.saving : t.settings.saveSettings}
          </Button>
          <Button variant="ghost" onClick={openDataDir}>
            <FolderOpen size={12} strokeWidth={1.75} />
            {t.settings.dataFolder}
          </Button>
          <Button variant="ghost" onClick={handleRestartCpa}>
            <RefreshCw size={12} strokeWidth={1.75} />
            {t.settings.restartCpa}
          </Button>
          {msg && (
            <span className="text-xs font-medium text-run">{msg}</span>
          )}
        </div>

        {/* ── config.yaml ─────────────────────────────────────────── */}
        <Section
          title={t.settings.configYaml}
          action={
            <div className="flex gap-1 items-center">
              <div className="flex gap-0.5 p-0.5 bg-raised rounded border border-border">
                {(['form', 'yaml'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setConfigTab(tab)}
                    className={cn(
                      'text-[10px] px-1.5 py-0.5 rounded border-0 cursor-pointer transition-colors uppercase tracking-wider',
                      configTab === tab
                        ? 'bg-hover text-text-1 font-semibold'
                        : 'bg-transparent text-text-3 hover:text-text-2',
                    )}
                  >
                    {tab}
                  </button>
                ))}
              </div>
              {configTab === 'yaml' && (
                <Button onClick={handleSaveYaml} disabled={saving} size="sm">
                  {t.settings.saveApply}
                </Button>
              )}
            </div>
          }
        >
          {configTab === 'form' ? (
            <ConfigForm />
          ) : (
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
              <Suspense
                fallback={
                  <div className="text-xs text-text-3 px-3 py-4">Loading editor…</div>
                }
              >
                <MonacoEditor
                  height={320}
                  language="yaml"
                  theme={theme === 'light' ? 'vs' : 'vs-dark'}
                  value={yaml}
                  onChange={(v) => setYaml(v ?? '')}
                  options={{
                    fontSize: 12,
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    tabSize: 2,
                  }}
                />
              </Suspense>
            </div>
          )}
        </Section>

        <p style={{ fontSize: 11, color: 'var(--c-text-3)' }}>
          {t.settings.restartNote}
        </p>
      </div>
    </div>
  )
}
