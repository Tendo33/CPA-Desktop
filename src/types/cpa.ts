export type CpaStatus =
  | { kind: 'Idle' }
  | { kind: 'Stopped' }
  | { kind: 'Starting' }
  | { kind: 'Running' }
  | { kind: 'Error'; data: string }
