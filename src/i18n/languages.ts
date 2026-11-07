// The languages the app can be shown in: Hebrew (the source, built into the code) and the 14 most
// spoken languages in the world. `speech` is the language the voice assistant listens and speaks in;
// `english` is the name the assistant model is told to answer in.

export interface Language {
  code: string
  name: string
  english: string
  dir: 'rtl' | 'ltr'
  speech: string
}

export const LANGUAGES: readonly Language[] = [
  { code: 'he', name: 'עברית', english: 'Hebrew', dir: 'rtl', speech: 'he-IL' },
  { code: 'en', name: 'English', english: 'English', dir: 'ltr', speech: 'en-US' },
  { code: 'ar', name: 'العربية', english: 'Arabic', dir: 'rtl', speech: 'ar-SA' },
  { code: 'ru', name: 'Русский', english: 'Russian', dir: 'ltr', speech: 'ru-RU' },
  { code: 'es', name: 'Español', english: 'Spanish', dir: 'ltr', speech: 'es-ES' },
  { code: 'fr', name: 'Français', english: 'French', dir: 'ltr', speech: 'fr-FR' },
  { code: 'de', name: 'Deutsch', english: 'German', dir: 'ltr', speech: 'de-DE' },
  { code: 'pt', name: 'Português', english: 'Portuguese', dir: 'ltr', speech: 'pt-BR' },
  { code: 'zh', name: '中文（简体）', english: 'Simplified Chinese', dir: 'ltr', speech: 'zh-CN' },
  { code: 'hi', name: 'हिन्दी', english: 'Hindi', dir: 'ltr', speech: 'hi-IN' },
  { code: 'bn', name: 'বাংলা', english: 'Bengali', dir: 'ltr', speech: 'bn-IN' },
  { code: 'ur', name: 'اردو', english: 'Urdu', dir: 'rtl', speech: 'ur-PK' },
  { code: 'id', name: 'Bahasa Indonesia', english: 'Indonesian', dir: 'ltr', speech: 'id-ID' },
  { code: 'ja', name: '日本語', english: 'Japanese', dir: 'ltr', speech: 'ja-JP' },
  { code: 'tr', name: 'Türkçe', english: 'Turkish', dir: 'ltr', speech: 'tr-TR' },
]

export const SOURCE = 'he'
export const languageOf = (code: string | null | undefined): Language => LANGUAGES.find((l) => l.code === code) ?? LANGUAGES[0]
