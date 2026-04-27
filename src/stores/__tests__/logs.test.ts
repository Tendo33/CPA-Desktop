import { describe, it, expect, beforeEach } from 'vitest'
import { useLogStore } from '@/stores/logs'

const MAX = 2000

describe('useLogStore', () => {
  beforeEach(() => useLogStore.getState().clear())

  it('starts empty', () => {
    expect(useLogStore.getState().lines).toEqual([])
  })

  it('appends a line and caps to MAX_LINES', () => {
    const { addLine } = useLogStore.getState()
    for (let i = 0; i < MAX + 50; i++) {
      addLine({ ts: String(i), level: 'stdout', text: `${i}` })
    }
    const lines = useLogStore.getState().lines
    expect(lines.length).toBeLessThanOrEqual(MAX)
    expect(lines[lines.length - 1]?.text).toBe(String(MAX + 50 - 1))
  })

  it('clears', () => {
    useLogStore.getState().addLine({ ts: '1', level: 'stdout', text: 'x' })
    useLogStore.getState().clear()
    expect(useLogStore.getState().lines).toEqual([])
  })
})
