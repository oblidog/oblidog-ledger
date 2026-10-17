import { i18n } from "./index"
import { type Language, supportedLanguage } from "./language"

export function getLocale(language?: Language) {
  const locales: Record<Language, string> = {
    en: "en-GB",
    pl: "pl-PL",
    de: "de-DE",
  }
  return locales[supportedLanguage(language ?? i18n.resolvedLanguage) ?? "en"]
}

// Calendar dates have no timezone. Formatting at UTC preserves the stored day.
export function formatDate(
  value: string,
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium" },
  language?: Language,
) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new RangeError("Expected an ISO calendar date")
  }
  const date = new Date(`${value}T00:00:00Z`)
  if (
    Number.isNaN(date.valueOf()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw new RangeError("Invalid calendar date")
  }
  return new Intl.DateTimeFormat(getLocale(language), {
    ...options,
    timeZone: "UTC",
  }).format(date)
}

export function formatDateTime(
  value: string | Date,
  options: Intl.DateTimeFormatOptions = {
    dateStyle: "medium",
    timeStyle: "short",
  },
  language?: Language,
) {
  return new Intl.DateTimeFormat(getLocale(language), options).format(
    typeof value === "string" ? new Date(value) : value,
  )
}

export function formatNumber(
  value: number,
  options?: Intl.NumberFormatOptions,
  language?: Language,
) {
  return new Intl.NumberFormat(getLocale(language), options).format(value)
}

export function formatAmount(
  value: string,
  currency?: string | null,
  language?: Language,
) {
  if (!/^-?\d+(\.\d+)?$/.test(value)) {
    throw new RangeError("Expected a decimal amount")
  }
  // Intl accepts exact decimal strings at runtime; the project's TS Intl types
  // still only declare number/bigint. Never convert monetary strings to Number.
  const fractionDigits = Math.max(2, value.split(".")[1]?.length ?? 0)
  const formatter = new Intl.NumberFormat(getLocale(language), {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })
  const amount = formatter.format(value as unknown as number)
  return currency ? `${amount} ${currency}` : amount
}

// Percentage points: 25 means 25%, not 2500%.
export function formatPercentage(value: number, language?: Language) {
  return new Intl.NumberFormat(getLocale(language), {
    style: "unit",
    unit: "percent",
    maximumFractionDigits: 2,
  }).format(value)
}

export function formatRegion(code: string, language?: Language) {
  return (
    new Intl.DisplayNames([getLocale(language)], { type: "region" }).of(code) ??
    code
  )
}
