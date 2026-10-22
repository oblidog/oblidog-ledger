import de from "../../backend/app/email-locales/de.json"
import en from "../../backend/app/email-locales/en.json"
import pl from "../../backend/app/email-locales/pl.json"

export type EmailLanguage = "en" | "pl" | "de"
/** Build-time previews share the exact runtime catalog; no translations live in TS. */
export function emailCopy(
  key: string,
  language: EmailLanguage = "en",
  params: Record<string, string | number> = {},
): string {
  let resolvedKey = key
  const catalog = { en, pl, de }[language] as Record<string, string>
  if (!(key in catalog) && typeof params.count === "number") {
    const count = params.count
    const form =
      language !== "pl"
        ? count === 1
          ? "one"
          : "other"
        : count === 1
          ? "one"
          : [2, 3, 4].includes(count % 10) &&
              ![12, 13, 14].includes(count % 100)
            ? "few"
            : "many"
    resolvedKey = `${key}_${form}`
  }
  if (!(resolvedKey in catalog))
    throw new Error(`Unknown email copy key: ${key}`)
  return catalog[resolvedKey].replace(/\{(\w+)\}/g, (_, name: string) =>
    String(params[name] ?? `{${name}}`),
  )
}
