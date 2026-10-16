import { i18n } from "./index"
import type { Language } from "./language"

function locale(language?: Language) {
  return (language ?? i18n.resolvedLanguage) === "pl" ? "pl-PL" : "en-GB"
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
  return new Intl.DateTimeFormat(locale(language), {
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
  return new Intl.DateTimeFormat(locale(language), options).format(
    typeof value === "string" ? new Date(value) : value,
  )
}

export function formatNumber(
  value: number,
  options?: Intl.NumberFormatOptions,
  language?: Language,
) {
  return new Intl.NumberFormat(locale(language), options).format(value)
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
  const formatter = new Intl.NumberFormat(locale(language), {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })
  const amount = formatter.format(value as unknown as number)
  return currency ? `${amount} ${currency}` : amount
}

// Percentage points: 25 means 25%, not 2500%.
export function formatPercentage(value: number, language?: Language) {
  return new Intl.NumberFormat(locale(language), {
    style: "unit",
    unit: "percent",
    maximumFractionDigits: 2,
  }).format(value)
}

export function formatRegion(code: string, language?: Language) {
  return (
    new Intl.DisplayNames([locale(language)], { type: "region" }).of(code) ??
    code
  )
}
