export const supportedLanguages = ["en", "pl", "de"] as const
export type Language = (typeof supportedLanguages)[number]
export const languageStorageKey = "oblidog-language"

export function supportedLanguage(value: unknown): Language | null {
  return value === "en" || value === "pl" || value === "de" ? value : null
}

export function browserLanguage(languages: readonly string[]): Language {
  for (const language of languages) {
    const supported = supportedLanguage(language.toLowerCase().split(/[-_]/)[0])
    if (supported) return supported
  }
  return "en"
}

export function resolveLanguage({
  accountLanguage,
  authenticated,
  demo,
  localLanguage,
  browserLanguages,
}: {
  accountLanguage?: unknown
  authenticated: boolean
  demo: boolean
  localLanguage?: unknown
  browserLanguages: readonly string[]
}): Language {
  const browser = browserLanguage(browserLanguages)
  if (authenticated && !demo) {
    return supportedLanguage(accountLanguage) ?? browser
  }
  return supportedLanguage(localLanguage) ?? browser
}

export function readLocalLanguage(): Language | null {
  try {
    return supportedLanguage(localStorage.getItem(languageStorageKey))
  } catch {
    return null
  }
}

export function writeLocalLanguage(language: Language) {
  try {
    localStorage.setItem(languageStorageKey, language)
  } catch {
    // A blocked storage API must not prevent an in-memory language change.
  }
}
