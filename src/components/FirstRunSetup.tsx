import { useState, useEffect } from 'react'
import { checkCpaUpdate, downloadCpaUpdate, type UpdateCheckResult } from '@/lib/tauri'
import { listen } from '@tauri-apps/api/event'
import { Download, Loader2, AlertCircle } from 'lucide-react'

interface Props {
  onComplete: () => void
}

export function FirstRunSetup({ onComplete }: Props) {
  const [update, setUpdate] = useState<UpdateCheckResult | null>(null)
  const [checking, setChecking] = useState(true)
  const [downloading, setDownloading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')

  useEffect(() => {
    checkCpaUpdate()
      .then(setUpdate)
      .catch((e) => setError(String(e)))
      .finally(() => setChecking(false))

    const unsubs = [
      listen<[number, number]>('cpa:download-progress', (e) => {
        const [dl, total] = e.payload
        setProgress(Math.round((dl / Math.max(total, 1)) * 100))
      }),
      listen('cpa:download-complete', () => {
        onComplete()
      }),
    ]
    return () => {
      unsubs.forEach((p) => p.then((fn) => fn()))
    }
  }, [onComplete])

  const handleDownload = async () => {
    if (!update) return
    setDownloading(true)
    setError('')
    try {
      await downloadCpaUpdate(update.downloadUrl, update.latestVersion)
    } catch (e) {
      setError(String(e))
      setDownloading(false)
    }
  }

  return (
    <div className="flex flex-col items-center justify-center h-screen bg-zinc-950 gap-6 p-8">
      {/* Logo */}
      <div className="w-16 h-16 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center mb-2">
        <span className="text-3xl font-bold text-zinc-100">C</span>
      </div>

      <div className="text-center space-y-2">
        <h1 className="text-2xl font-bold text-zinc-100">Welcome to CPA Desktop</h1>
        <p className="text-zinc-500 text-sm max-w-sm">
          CLIProxyAPI needs to be downloaded before you can start. This is a
          one-time setup (~14 MB).
        </p>
      </div>

      {/* States */}
      {checking && (
        <div className="flex items-center gap-2 text-zinc-500 text-sm">
          <Loader2 size={15} className="animate-spin" />
          Checking latest release...
        </div>
      )}

      {!checking && !downloading && update && (
        <div className="space-y-3 text-center">
          <p className="text-xs text-zinc-500">
            Latest version:{' '}
            <span className="text-zinc-300 font-medium">{update.latestVersion}</span>
          </p>
          <button
            onClick={handleDownload}
            className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-xl transition-colors cursor-pointer"
          >
            <Download size={15} />
            Download CLIProxyAPI {update.latestVersion}
          </button>
        </div>
      )}

      {downloading && (
        <div className="w-64 space-y-3 text-center">
          <div className="bg-zinc-800 rounded-full h-2 overflow-hidden">
            <div
              className="bg-blue-500 h-full rounded-full transition-all duration-200"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-xs text-zinc-500">{progress}% downloaded</p>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 text-red-400 text-sm max-w-sm text-center">
          <AlertCircle size={15} className="shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!checking && !update && !error && (
        <div className="flex items-center gap-2 text-zinc-500 text-sm">
          <AlertCircle size={15} />
          Could not fetch release info. Check your internet connection.
        </div>
      )}
    </div>
  )
}
