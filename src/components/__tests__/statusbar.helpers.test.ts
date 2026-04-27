import { describe, it, expect } from 'vitest'
import { dotClass, statusColor } from '@/components/statusbar.helpers'
import type { CpaStatus } from '@/lib/tauri'

describe('StatusBar helpers', () => {
  const cases: Array<[CpaStatus, string, string]> = [
    ['Running', 'status-dot running', 'var(--c-run)'],
    ['Starting', 'status-dot starting', 'var(--c-start)'],
    ['Stopped', 'status-dot idle', 'var(--c-text-3)'],
    ['Idle', 'status-dot idle', 'var(--c-text-3)'],
  ]

  it.each(cases)('%s -> %s / %s', (s, dot, color) => {
    expect(dotClass(s)).toBe(dot)
    expect(statusColor(s)).toBe(color)
  })

  it('object error -> error dot + err color', () => {
    const status = { error: 'boom' } as unknown as CpaStatus
    expect(dotClass(status)).toBe('status-dot error')
    expect(statusColor(status)).toBe('var(--c-err)')
  })
})
