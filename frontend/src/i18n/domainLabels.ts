import { i18n } from "./index"
import en from "./locales/en/domain.json"
import pl from "./locales/pl/domain.json"

/** Only known system identifiers are translated. Custom values stay untouched. */
export function domainLabel(group: keyof typeof en, value: string): string {
  const dictionary = (i18n.resolvedLanguage === "pl" ? pl : en)[
    group
  ] as Record<string, string>
  return Object.keys(dictionary).includes(value) ? dictionary[value] : value
}
