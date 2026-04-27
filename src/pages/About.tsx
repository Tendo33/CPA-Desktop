import { useEffect, useState } from 'react'
import {
  checkCpaUpdate,
  downloadCpaUpdate,
  stopCpa,
  startCpa,
  type UpdateCheckResult,
} from '@/lib/tauri'
import { useCpaStore } from '@/stores/cpa'
import { listen } from '@tauri-apps/api/event'
import { getVersion } from '@tauri-apps/api/app'
import {
  RefreshCw,
  Download,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
} from 'lucide-react'

export function AboutPage() {
  const { status } = useCpaStore()
  const [appVersion, setAppVersion] = useState('')
  const [update, setUpdate] = useState<UpdateCheckResult | null>(null)
  const [checking, setChecking] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [progress, setProgress] = useState<[number, number] | null>(null)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => setAppVersion('0.1.0'))

    const unsubs = [
      listen<[number, number]>('cpa:download-progress', (e) => {
        setProgress(e.payload)
      }),
      listen('cpa:download-complete', () => {
        setDone(true)
        setDownloading(false)
        setProgress(null)
        // auto-start after download
        setTimeout(() => startCpa(), 300)
      }),
    ]
    return () => {
      unsubs.forEach((p) => p.then((fn) => fn()))
    }
  }, [])

  const handleCheck = async () => {
    setChecking(true)
    setError('')
    setDone(false)
    try {
      const result = await checkCpaUpdate()
      setUpdate(result)
    } catch (e) {
      setError(String(e))
    }
    setChecking(false)
  }

  const handleUpdate = async () => {
    if (!update) return
    setDownloading(true)
    setDone(false)
    setError('')
    try {
      if (status === 'Running') await stopCpa()
      await downloadCpaUpdate(update.downloadUrl, update.latestVersion)
    } catch (e) {
      setError(String(e))
      setDownloading(false)
    }
  }

  const pct = progress
    ? Math.round((progress[0] / Math.max(progress[1], 1)) * 100)
    : 0

  return (
    <div className="h-full overflow-y-auto bg-zinc-950 select-text">
      <div className="max-w-lg mx-auto p-6 space-y-8">
        {/* App info */}
        <section className="space-y-2">
          <h1 className="text-xl font-bold text-zinc-100">CPA Desktop</h1>
          <p className="text-sm text-zinc-500">
            Desktop manager for CLIProxyAPI — start, update, and monitor without
            a terminal window.
          </p>
          <div className="flex gap-3 text-xs text-zinc-600">
            <span>App v{appVersion}</span>
            {update?.currentVersion && (
              <span>CPA {update.currentVersion}</span>
            )}
          </div>
        </section>

        {/* CPA binary update */}
        <section className="space-y-4">
          <h2 className="text-sm font-semibold text-zinc-200 pb-2 border-b border-zinc-800">
            CLIProxyAPI Binary
          </h2>

          {update && (
            <div className="text-xs space-y-1">
              <div className="flex gap-6 text-zinc-400">
                <span>
                  Installed:{' '}
                  <span className="text-zinc-200">
                    {update.currentVersion ?? '—'}
                  </span>
                </span>
                <span>
                  Latest:{' '}
                  <span className="text-zinc-200">{update.latestVersion}</span>
                </span>
              </div>
              {!update.updateAvailable && !done && (
                <p className="text-green-500 flex items-center gap-1">
                  <CheckCircle2 size={12} />
                  Already up to date
                </p>
              )}
            </div>
          )}

          <div className="flex gap-2 flex-wrap">
            <button
              onClick={handleCheck}
              disabled={checking || downloading}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs rounded-lg transition-colors cursor-pointer disabled:opacity-50"
            >
              <RefreshCw size={12} className={checking ? 'animate-spin' : ''} />
              {checking ? 'Checking...' : 'Check for Updates'}
            </button>

            {update?.updateAvailable && !done && (
              <button
                onClick={handleUpdate}
                disabled={downloading}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded-lg transition-colors cursor-pointer disabled:opacity-50"
              >
                <Download size={12} />
                {downloading
                  ? `Downloading ${pct}%`
                  : `Update to ${update.latestVersion}`}
              </button>
            )}
          </div>

          {/* Progress bar */}
          {downloading && progress && (
            <div className="w-full bg-zinc-800 rounded-full h-1.5 overflow-hidden">
              <div
                className="bg-blue-500 h-full rounded-full transition-all duration-200"
                style={{ width: `${pct}%` }}
              />
            </div>
          )}

          {/* Success */}
          {done && (
            <p className="flex items-center gap-1.5 text-xs text-green-400">
              <CheckCircle2 size={13} />
              Updated successfully — CPA is restarting
            </p>
          )}

          {/* Error */}
          {error && (
            <p className="flex items-center gap-1.5 text-xs text-red-400">
              <AlertCircle size={13} />
              {error}
            </p>
          )}
        </section>

        {/* Links */}
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-zinc-200 pb-2 border-b border-zinc-800">
            Links
          </h2>
          <div className="space-y-1.5 text-xs">
            {[
              {
                label: 'CLIProxyAPI on GitHub',
                url: 'https://github.com/router-for-me/CLIProxyAPI',
              },
              {
                label: 'CLIProxyAPI Guides',
                url: 'https://help.router-for.me/',
              },
              {
                label: 'CPA Desktop on GitHub',
                url: 'https://github.com/TuDou/CPA-Desktop',
              },
            ].map(({ label, url }) => (
              <a
                key={url}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-zinc-500 hover:text-zinc-200 transition-colors"
              >
                <ExternalLink size={11} />
                {label}
              </a>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
