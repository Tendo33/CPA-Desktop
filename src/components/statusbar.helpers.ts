import type { CpaStatus } from '@/lib/tauri'

export function dotClass(status: CpaStatus): string {
  switch (status.kind) {
    case 'Running':
      return 'status-dot running'
    case 'Starting':
      return 'status-dot starting'
    case 'Error':
      return 'status-dot error'
    default:
      return 'status-dot idle'
  }
}

export function statusColor(status: CpaStatus): string {
  switch (status.kind) {
    case 'Running':
      return 'var(--c-run)'
    case 'Starting':
      return 'var(--c-start)'
    case 'Error':
      return 'var(--c-err)'
    default:
      return 'var(--c-text-3)'
  }
}
