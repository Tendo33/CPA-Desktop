import { describe, it, expect, beforeEach } from 'vitest'
import { useSettingsStore } from '@/stores/settings'

describe('useSettingsStore', () => {
  beforeEach(() => {
    useSettingsStore.setState({ theme: 'dark', lang: 'en' })
  })

  it('switches theme', () => {
    useSettingsStore.getState().setTheme('light')
    expect(useSettingsStore.getState().theme).toBe('light')
  })

  it('switches lang', () => {
    useSettingsStore.getState().setLang('zh')
    expect(useSettingsStore.getState().lang).toBe('zh')
  })
})
