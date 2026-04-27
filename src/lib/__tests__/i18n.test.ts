import { describe, it, expect } from 'vitest'
import { translations } from '@/lib/i18n'

function flattenKeys(obj: unknown, prefix = ''): string[] {
  if (obj === null || typeof obj !== 'object' || typeof obj === 'function') {
    return [prefix]
  }
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
    flattenKeys(v, prefix ? `${prefix}.${k}` : k),
  )
}

describe('i18n', () => {
  it('zh and en have identical key sets', () => {
    const zhKeys = new Set(flattenKeys(translations.zh))
    const enKeys = new Set(flattenKeys(translations.en))
    const onlyInZh = [...zhKeys].filter((k) => !enKeys.has(k))
    const onlyInEn = [...enKeys].filter((k) => !zhKeys.has(k))
    expect(onlyInZh).toEqual([])
    expect(onlyInEn).toEqual([])
  })
})
