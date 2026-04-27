import { describe, it, expect } from 'vitest'
import { cn } from '@/lib/utils'

describe('cn', () => {
  it('joins truthy class names', () => {
    expect(cn('a', 'b')).toBe('a b')
  })
  it('skips falsy values', () => {
    const flag = false as boolean
    expect(cn('a', flag && 'b', null, undefined, 'c')).toBe('a c')
  })
  it('merges conflicting tailwind classes', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4')
  })
})
