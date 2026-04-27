import { useSettingsStore } from '@/stores/settings'
import { translations, type Translations } from '@/locales'

export { translations }
export type { Translations }

export function useT(): Translations {
  const lang = useSettingsStore((s) => s.lang)
  return translations[lang] as unknown as Translations
}
