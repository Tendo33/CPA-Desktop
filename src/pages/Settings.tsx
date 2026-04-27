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
import { FolderOpen, Save, RefreshCw } from 'lucide-react'

export function SettingsPage() {
  const { status } = useCpaStore()
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [yaml, setYaml] = useState('')
  const [saving, setSaving] = useState(false)
  const [yamlError, setYamlError] = useState('')
  const [msg, setMsg] = useState('')
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
      flash(checked ? 'Will launch on system login' : 'Removed from startup')
    } catch (e) {
      flash(`Error: ${e}`)
    }
  }

  const handleSaveSettings = async () => {
    if (!settings) return
    setSaving(true)
    try {
      await saveSettings(settings)
      flash('Settings saved')
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
      flash('config.yaml saved')
    } catch (e) {
      setYamlError(String(e))
    }
    setSaving(false)
  }

  const handleRestartCpa = async () => {
    if (status === 'Running') await stopCpa()
    setTimeout(() => startCpa(), 500)
  }

  if (!settings) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-600 text-xs">
        Loading...
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto bg-zinc-950 select-text">
      <div className="max-w-2xl mx-auto p-6 space-y-8">
        {/* App Settings */}
        <section>
          <h2 className="text-sm font-semibold text-zinc-200 mb-4 pb-2 border-b border-zinc-800">
            Application Settings
          </h2>
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <label className="text-xs text-zinc-400 w-28 shrink-0">CPA Port</label>
              <input
                type="number"
                value={settings.port}
                min={1024}
                max={65535}
                onChange={(e) =>
                  setSettings({ ...settings, port: Number(e.target.value) })
                }
                className="h-7 text-xs bg-zinc-900 border border-zinc-700 rounded px-2 text-zinc-200 outline-none focus:border-zinc-500 w-24"
              />
              {yamlPort !== null && yamlPort !== settings.port && (
                <span className="text-xs text-yellow-500">
                  config.yaml uses port {yamlPort} — edit config.yaml to change
                </span>
              )}
              {yamlPort === settings.port && (
                <span className="text-xs text-zinc-600">synced with config.yaml</span>
              )}
            </div>

            <div className="flex items-center gap-4">
              <label className="text-xs text-zinc-400 w-28 shrink-0">
                Auto-start CPA
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.autoStart}
                  onChange={(e) =>
                    setSettings({ ...settings, autoStart: e.target.checked })
                  }
                  className="w-3.5 h-3.5 accent-blue-500"
                />
                <span className="text-xs text-zinc-300">
                  Auto-start CPA when app opens
                </span>
              </label>

            <div className="flex items-center gap-4">
              <label className="text-xs text-zinc-400 w-28 shrink-0">System Login</label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autolaunch}
                  onChange={(e) => handleAutolaunchChange(e.target.checked)}
                  className="w-3.5 h-3.5 accent-blue-500"
                />
                <span className="text-xs text-zinc-300">
                  Launch CPA Desktop on system login
                </span>
              </label>
            </div>
            </div>

            <div className="flex items-center gap-3 pt-1">
              <button
                onClick={handleSaveSettings}
                disabled={saving}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs rounded-lg transition-colors cursor-pointer disabled:opacity-50"
              >
                <Save size={12} />
                Save Settings
              </button>
              <button
                onClick={openDataDir}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs rounded-lg transition-colors cursor-pointer"
              >
                <FolderOpen size={12} />
                Open Data Folder
              </button>
              <button
                onClick={handleRestartCpa}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs rounded-lg transition-colors cursor-pointer"
              >
                <RefreshCw size={12} />
                Restart CPA
              </button>
              {msg && (
                <span className="text-xs text-green-400">{msg}</span>
              )}
            </div>
          </div>
        </section>

        {/* config.yaml editor */}
        <section>
          <div className="flex items-center justify-between mb-3 pb-2 border-b border-zinc-800">
            <h2 className="text-sm font-semibold text-zinc-200">config.yaml</h2>
            <button
              onClick={handleSaveYaml}
              disabled={saving}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs rounded-lg transition-colors cursor-pointer disabled:opacity-50"
            >
              <Save size={12} />
              Save & Apply
            </button>
          </div>
          {yamlError && (
            <p className="text-xs text-red-400 mb-2 p-2 bg-red-950/30 rounded border border-red-900">
              {yamlError}
            </p>
          )}
          <textarea
            value={yaml}
            onChange={(e) => setYaml(e.target.value)}
            spellCheck={false}
            className="w-full h-96 font-mono text-[11px] bg-zinc-900 border border-zinc-700 rounded-lg p-3 text-zinc-300 resize-y outline-none focus:border-zinc-500 leading-5"
          />
          <p className="text-[11px] text-zinc-600 mt-1">
            Restart CPA after saving config changes for them to take effect.
          </p>
        </section>
      </div>
    </div>
  )
}
