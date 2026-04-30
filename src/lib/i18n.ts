import { useSettingsStore } from '@/stores/settings'
import { translations } from '@/locales'

export { translations }

type Translations = typeof translations.en

export function useT(): Translations {
  const lang = useSettingsStore((s) => s.lang)
  return translations[lang] as unknown as Translations
}
