import { en } from './en'
import { zh } from './zh'

export const translations = { en, zh } as const
export type Lang = keyof typeof translations
export type Translations = typeof translations.en
