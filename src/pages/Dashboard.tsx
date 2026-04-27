import { useRef } from 'react'
import { CpaWebView, type CpaWebViewHandle } from '@/components/CpaWebView'
import { useCpaStore } from '@/stores/cpa'
import { startCpa } from '@/lib/tauri'
import { Loader2, AlertCircle, RefreshCw, Download } from 'lucide-react'

export function Dashboard() {
  const { status, port } = useCpaStore()
  const webviewRef = useRef<CpaWebViewHandle>(null)

  const isRunning = status === 'Running'
  const isStarting = status === 'Starting'
  const isError = typeof status === 'object'
  const isIdle = status === 'Idle'
  const isStopped = status === 'Stopped'
  const showOverlay = !isRunning

  const managementUrl = `http://localhost:${port}/management.html#/quota`

  return (
    <div className="relative w-full h-full bg-zinc-950 overflow-hidden">
      {/* Child webview — sits behind overlays */}
      <CpaWebView ref={webviewRef} url={managementUrl} visible={isRunning} />

      {/* Starting overlay */}
      {isStarting && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-zinc-950 z-10">
          <div className="p-4 rounded-full bg-zinc-900">
            <Loader2 className="w-8 h-8 animate-spin text-zinc-400" />
          </div>
          <p className="text-zinc-400 text-sm">Starting CPA...</p>
          <p className="text-zinc-600 text-xs">
            Waiting for http://localhost:{port}
          </p>
        </div>
      )}

      {/* Idle / first run overlay */}
      {isIdle && !isStarting && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 bg-zinc-950 z-10">
          <div className="p-4 rounded-full bg-zinc-900">
            <Download className="w-8 h-8 text-zinc-500" />
          </div>
          <div className="text-center space-y-1">
            <p className="text-zinc-300 font-medium">CPA not downloaded yet</p>
            <p className="text-zinc-500 text-xs">
              Go to About to download the CLIProxyAPI binary
            </p>
          </div>
        </div>
      )}

      {/* Stopped / Error overlay */}
      {(isStopped || isError) && !isStarting && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 bg-zinc-950 z-10">
          <div className="p-4 rounded-full bg-zinc-900">
            <AlertCircle
              className={`w-8 h-8 ${isError ? 'text-red-400' : 'text-zinc-500'}`}
            />
          </div>
          <div className="text-center space-y-1">
            <p className="text-zinc-300 font-medium">
              {isError ? 'CPA encountered an error' : 'CPA is not running'}
            </p>
            {isError && (
              <p className="text-red-400 text-xs max-w-sm">
                {(status as { error: string }).error}
              </p>
            )}
          </div>
          <button
            onClick={() => startCpa()}
            className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm rounded-lg transition-colors cursor-pointer"
          >
            <RefreshCw size={14} />
            Start CPA
          </button>
        </div>
      )}

      {/* Hidden placeholder so React tree stays consistent */}
      {!showOverlay && <div className="w-full h-full" />}
    </div>
  )
}
