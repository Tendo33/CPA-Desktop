import { useCpaStore } from '@/stores/cpa'
import { startCpa, stopCpa } from '@/lib/tauri'
import { cn } from '@/lib/utils'
import type { CpaStatus } from '@/lib/tauri'

function statusLabel(status: CpaStatus): string {
  if (typeof status === 'object') return `Error`
  return status
}

function StatusDot({ status }: { status: CpaStatus }) {
  const isRunning = status === 'Running'
  const isStarting = status === 'Starting'
  const isError = typeof status === 'object'

  return (
    <span
      className={cn(
        'inline-block w-2 h-2 rounded-full shrink-0',
        isRunning && 'bg-green-500',
        isStarting && 'bg-yellow-400 animate-pulse',
        isError && 'bg-red-500',
        !isRunning && !isStarting && !isError && 'bg-zinc-600',
      )}
    />
  )
}

export function StatusBar() {
  const { status, port } = useCpaStore()
  const isRunning = status === 'Running'

  return (
    <div className="flex items-center gap-3 px-4 h-7 text-xs text-zinc-400 bg-zinc-900 border-t border-zinc-800 shrink-0 select-none">
      <StatusDot status={status} />
      <span className="font-medium text-zinc-300">CPA</span>
      <span>{statusLabel(status)}</span>
      {typeof status === 'object' && (
        <span className="text-red-400 truncate max-w-xs">{status.error}</span>
      )}
      <span className="ml-auto text-zinc-600">:{port}</span>
      <button
        onClick={() => (isRunning ? stopCpa() : startCpa())}
        className={cn(
          'px-2 py-0.5 rounded text-[10px] font-medium transition-colors cursor-pointer',
          isRunning
            ? 'bg-zinc-700 hover:bg-red-900 text-zinc-300 hover:text-red-300'
            : 'bg-zinc-700 hover:bg-green-900 text-zinc-300 hover:text-green-300',
        )}
      >
        {isRunning ? 'Stop' : 'Start'}
      </button>
    </div>
  )
}
