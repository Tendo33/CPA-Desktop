import { cn } from '@/lib/utils'
import type { ToastItem } from '@/stores/toast'

interface ToastProps {
  item: ToastItem
  onDismiss: () => void
}

const toneStyles: Record<ToastItem['tone'], string> = {
  info: 'border-border bg-surface text-text-1',
  success: 'border-run/40 bg-surface text-run',
  error: 'border-err/40 bg-err-bg text-err',
}

export function Toast({ item, onDismiss }: ToastProps) {
  return (
    <div
      role="status"
      className={cn(
        'pointer-events-auto flex items-center gap-3 rounded-md border px-3 py-2 text-xs shadow-md',
        toneStyles[item.tone],
      )}
    >
      <span className="flex-1">{item.message}</span>
      <button
        type="button"
        onClick={onDismiss}
        className="text-text-3 hover:text-text-1 text-[10px]"
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  )
}
