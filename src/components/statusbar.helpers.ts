import type { CpaStatus } from '@/lib/tauri'

export function dotClass(status: CpaStatus): string {
  if (status === 'Running') return 'status-dot running'
  if (status === 'Starting') return 'status-dot starting'
  if (typeof status === 'object') return 'status-dot error'
  return 'status-dot idle'
}

export function statusColor(status: CpaStatus): string {
  if (status === 'Running') return 'var(--c-run)'
  if (status === 'Starting') return 'var(--c-start)'
  if (typeof status === 'object') return 'var(--c-err)'
  return 'var(--c-text-3)'
}
