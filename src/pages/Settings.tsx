import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
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
import { ChevronDown, ChevronRight, FolderOpen, RefreshCw } from 'lucide-react'
import { useT } from '@/lib/i18n'
import { Button, Input, NumberInput, Row, Section, Toggle, Tabs } from '@/components/ui'
import { ConfigForm } from '@/components/ConfigForm'
import { InstallSourceCard } from '@/components/InstallSourceCard'
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
  const [yaml, setYaml] = useState('')
  const [yamlError, setYamlError] = useState('')
  const [msg, setMsg] = useState('')
  const [autolaunch, setAutolaunch] = useState(false)
  const [yamlPort, setYamlPort] = useState<number | null>(null)
  const [updateMsg, setUpdateMsg] = useState('')
  const [configTab, setConfigTab] = useState<'form' | 'yaml'>('form')
  const [needsRestart, setNeedsRestart] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const theme = useSettingsStore((s) => s.theme)

  useEffect(() => {
    const onDirty = (e: Event) => {
      const detail = (e as CustomEvent<{ needsRestart?: boolean }>).detail
      if (detail?.needsRestart) setNeedsRestart(true)
    }
    window.addEventListener('cpa-config-dirty', onDirty)
    return () => window.removeEventListener('cpa-config-dirty', onDirty)
  }, [])

  useEffect(() => {
    getSettings().then(setSettings)
    readConfigYaml()
      .then(setYaml)
      .catch(() => {})
    getAutolaunchEnabled()
      .then(setAutolaunch)
      .catch(() => {})
    getPortFromYaml()
      .then(setYamlPort)
      .catch(() => {})
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

  // Debounce text/number inputs so we don't atomic_write on every keystroke
  // (each save triggers an fsync; chained writes would visibly stutter).
  // Toggles bypass the debounce because they're discrete and the user
  // expects immediate feedback ("did the toggle take?").
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingSave = useRef<AppSettings | null>(null)

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      // Flush a final pending write on unmount so the user doesn't lose
      // edits by navigating away mid-debounce.
      if (pendingSave.current) {
        void saveSettings(pendingSave.current).catch(() => {})
      }
    }
  }, [])

  const flushSave = useCallback(async () => {
    if (!pendingSave.current) return
    const snapshot = pendingSave.current
    pendingSave.current = null
    try {
      await saveSettings(snapshot)
    } catch (e) {
      flash(String(e))
    }
  }, [])

  const updateSetting = (updates: Partial<AppSettings>, opts?: { immediate?: boolean }) => {
    if (!settings) return
    const next = { ...settings, ...updates }
    setSettings(next)
    pendingSave.current = next
    if (opts?.immediate) {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current)
        saveTimer.current = null
      }
      void flushSave()
      return
    }
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null
      void flushSave()
    }, 400)
  }

  const handleSaveYaml = async () => {
    setYamlError('')
    try {
      await writeConfigYaml(yaml)
      flash(t.settings.configSaved)
    } catch (e) {
      setYamlError(String(e))
    }
  }

  const onCheckUpdate = async () => {
    setUpdateMsg(t.appUpdate.checking)
    try {
      const u = await checkAppUpdate()
      if (!u) {
        setUpdateMsg(t.appUpdate.upToDate)
        return
      }
      if (confirm(t.appUpdate.confirmInstall(u.version))) {
        setUpdateMsg(t.appUpdate.downloading)
        await applyAppUpdate(u)
      } else {
        setUpdateMsg(t.appUpdate.available(u.version))
      }
    } catch (e) {
      setUpdateMsg(String(e))
    }
  }

  const handleRestartCpa = async () => {
    if (status.kind === 'Running') await stopCpa()
    setTimeout(() => startCpa(), 500)
    setNeedsRestart(false)
  }

  if (!settings) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: 'var(--c-text-3)',
          fontSize: 12,
        }}
      >
        {t.settings.loading}
      </div>
    )
  }

  const portMismatch = yamlPort !== null && yamlPort !== settings.port

  return (
    <div className="selectable app-scroll-page">
      <div className="settings-shell">
        {/* ── Restart-required banner ────────────────────────────── */}
        {needsRestart && (
          <div
            style={{
              padding: '10px 14px',
              background: 'var(--c-accent-bg)',
              border: '1px solid var(--c-accent-dim)',
              borderRadius: 8,
              fontSize: 12,
              color: 'var(--c-text-1)',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              justifyContent: 'space-between',
            }}
          >
            <span>{t.settings.restartRequiredBanner}</span>
            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
              <Button size="sm" onClick={handleRestartCpa}>
                {t.settings.restartNow}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setNeedsRestart(false)}>
                {t.settings.dismiss}
              </Button>
            </div>
          </div>
        )}

        {/* ── Install source ─────────────────────────────────────── */}
        <InstallSourceCard defaultOpen={false} />

        <div className="settings-grid">
          <div className="settings-stack">
            {/* ── Application ─────────────────────────────────────────── */}
            <Section title={t.settings.application}>
              <Row
                first
                label={t.settings.cpaPort}
                hint={portMismatch ? t.settings.portMismatch(yamlPort!) : t.settings.portHint}
              >
                <div className="flex items-center justify-end gap-2">
                  {portMismatch && (
                    <span className="text-[11px] text-start font-semibold whitespace-nowrap">
                      {t.settings.mismatch}
                    </span>
                  )}
                  <NumberInput
                    aria-label={t.settings.cpaPort}
                    value={settings.port}
                    min={1024}
                    max={65535}
                    onChange={(n) => updateSetting({ port: n })}
                  />
                </div>
              </Row>

              <Row label={t.settings.autoStartCpa} hint={t.settings.autoStartHint}>
                <Toggle
                  checked={settings.autoStart}
                  onChange={(v) => updateSetting({ autoStart: v }, { immediate: true })}
                  ariaLabel={t.settings.autoStartCpa}
                />
              </Row>

              <Row label={t.settings.launchOnLogin} hint={t.settings.launchOnLoginHint}>
                <Toggle
                  checked={autolaunch}
                  onChange={handleAutolaunchChange}
                  ariaLabel={t.settings.launchOnLogin}
                />
              </Row>

              <Row
                label={t.settings.checkAppUpdate}
                hint={updateMsg || t.settings.checkAppUpdateHint}
              >
                <Button variant="ghost" size="sm" onClick={onCheckUpdate}>
                  {t.settings.checkNow}
                </Button>
              </Row>

              <Row label={t.settings.autoCheck} hint={t.settings.autoCheckHint}>
                <Toggle
                  checked={settings.autoCheckAppUpdates ?? false}
                  onChange={(v) => updateSetting({ autoCheckAppUpdates: v }, { immediate: true })}
                  ariaLabel={t.settings.autoCheck}
                />
              </Row>
            </Section>

            {/* ── Advanced (process-management knobs) ─────────────────── */}
            <Section
              title={t.settings.advanced}
              action={
                <Button
                  variant="ghost"
                  size="sm"
                  aria-expanded={advancedOpen}
                  onClick={() => setAdvancedOpen((v) => !v)}
                >
                  {advancedOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  {advancedOpen ? t.settings.hideDetails : t.settings.showDetails}
                </Button>
              }
            >
              {advancedOpen ? (
                <>
                  <Row first label={t.settings.startTimeout} hint={t.settings.startTimeoutHint}>
                    <NumberInput
                      aria-label={t.settings.startTimeout}
                      value={settings.startTimeoutSecs ?? 60}
                      min={5}
                      max={600}
                      onChange={(n) => updateSetting({ startTimeoutSecs: n })}
                    />
                  </Row>
                  <Row label={t.settings.autoRestart} hint={t.settings.autoRestartHint}>
                    <Toggle
                      checked={settings.autoRestart ?? true}
                      onChange={(v) => updateSetting({ autoRestart: v }, { immediate: true })}
                      ariaLabel={t.settings.autoRestart}
                    />
                  </Row>
                  <Row
                    label={t.settings.healthPath}
                    hint={t.settings.healthPathHint}
                    controlClassName="w-full sm:w-auto"
                  >
                    <Input
                      aria-label={t.settings.healthPath}
                      value={settings.healthPath ?? '/health'}
                      onChange={(e) => updateSetting({ healthPath: e.target.value })}
                      className="w-full sm:w-56"
                    />
                  </Row>
                  <Row
                    label={t.settings.mirrors}
                    hint={t.settings.mirrorsHint}
                    controlClassName="w-full sm:w-auto"
                  >
                    <Input
                      aria-label={t.settings.mirrors}
                      value={(settings.mirrors ?? []).join(', ')}
                      onChange={(e) =>
                        updateSetting({
                          mirrors: e.target.value
                            .split(',')
                            .map((s) => s.trim())
                            .filter(Boolean),
                        })
                      }
                      className="w-full sm:w-80"
                    />
                  </Row>
                </>
              ) : (
                <div className="settings-collapsed-summary">{t.settings.advancedSummary}</div>
              )}
            </Section>

            {/* ── Actions ─────────────────────────────────────────────── */}
            <div className="flex items-center gap-2 flex-wrap">
              <Button variant="ghost" onClick={openDataDir}>
                <FolderOpen size={14} strokeWidth={1.75} />
                {t.settings.dataFolder}
              </Button>
              <Button variant="ghost" onClick={handleRestartCpa}>
                <RefreshCw size={14} strokeWidth={1.75} />
                {t.settings.restartCpa}
              </Button>
              {msg && <span className="text-xs font-medium text-run">{msg}</span>}
            </div>
          </div>

          <div className="settings-stack">
            {/* ── config.yaml ─────────────────────────────────────────── */}
            <Section
              title={t.settings.configYaml}
              action={
                <div className="flex gap-2 items-center">
                  <Tabs
                    items={[
                      { id: 'form', label: t.settings.configFormTab },
                      { id: 'yaml', label: t.settings.yamlTab },
                    ]}
                    active={configTab}
                    onChange={setConfigTab}
                    tabClassName={(active) =>
                      cn(
                        active
                          ? 'bg-hover text-text-1 font-semibold'
                          : 'bg-transparent text-text-3 hover:text-text-2',
                      )
                    }
                  />
                  {configTab === 'yaml' && (
                    <Button onClick={handleSaveYaml} size="sm">
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
                        padding: '10px 14px',
                        borderBottom: '1px solid var(--c-err-border)',
                        background: 'var(--c-err-bg)',
                        fontSize: 12,
                        color: 'var(--c-err)',
                      }}
                    >
                      {yamlError}
                    </div>
                  )}
                  <Suspense
                    fallback={
                      <div className="text-xs text-text-3 px-4 py-5">{t.common.loading}</div>
                    }
                  >
                    <MonacoEditor
                      height={380}
                      language="yaml"
                      theme={theme === 'light' ? 'vs' : 'vs-dark'}
                      value={yaml}
                      onChange={(v) => setYaml(v ?? '')}
                      options={{
                        fontSize: 13,
                        minimap: { enabled: false },
                        scrollBeyondLastLine: false,
                        tabSize: 2,
                      }}
                    />
                  </Suspense>
                </div>
              )}
            </Section>

            <p className="text-[12px] leading-relaxed text-text-3">{t.settings.restartNote}</p>
          </div>
        </div>
      </div>
    </div>
  )
}
