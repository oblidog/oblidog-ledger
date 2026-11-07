import { i18n } from "./index"
import { supportedLanguage } from "./language"
import de from "./locales/de/domain.json"
import en from "./locales/en/domain.json"
import pl from "./locales/pl/domain.json"

/** Only known system identifiers are translated. Custom values stay untouched. */
export function domainLabel(group: keyof typeof en, value: string): string {
  const dictionary = { en, pl, de }[
    supportedLanguage(i18n.resolvedLanguage) ?? "en"
  ][group] as Record<string, string>
  // Match the known uppercase integration spelling only in the display lookup.
  const key =
    group === "componentType" && value === "INVOICE_LINE"
      ? "invoice_line"
      : value
  return Object.keys(dictionary).includes(key) ? dictionary[key] : value
}
