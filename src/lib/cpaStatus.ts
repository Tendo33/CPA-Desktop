import type { CpaStatus } from '@/types/cpa'

export const isRunning = (s: CpaStatus): boolean => s.kind === 'Running'
export const isStarting = (s: CpaStatus): boolean => s.kind === 'Starting'
export const isStopped = (s: CpaStatus): boolean => s.kind === 'Stopped'
export const isIdle = (s: CpaStatus): boolean => s.kind === 'Idle'
export const isError = (s: CpaStatus): boolean => s.kind === 'Error'
export const errorOf = (s: CpaStatus): string | null => (s.kind === 'Error' ? s.data : null)

export const IDLE: CpaStatus = { kind: 'Idle' }
export const RUNNING: CpaStatus = { kind: 'Running' }
