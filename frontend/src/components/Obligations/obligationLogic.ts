import type { ObligationLifecycle, ObligationPublic } from "@/client"

export type LifecycleFilter = ObligationLifecycle | "" | "unpaid"

export const lifecycleOptions: LifecycleFilter[] = [
  "",
  "unpaid",
  "draft",
  "collecting_data",
  "ready",
  "paid",
  "canceled",
  "error",
]

export type ObligationFilters = {
  year: string
  month: string
  filterByPeriod: boolean
  categoryCode: string
  lifecycle: LifecycleFilter
}

export function isValidPeriod(year: number, month: number) {
  return (
    Number.isInteger(year) &&
    year >= 1 &&
    year <= 9999 &&
    Number.isInteger(month) &&
    month >= 1 &&
    month <= 12
  )
}

export function monthInputValue(year: string, month: string) {
  const parsedYear = Number(year)
  const parsedMonth = Number(month)
  if (!isValidPeriod(parsedYear, parsedMonth)) {
    return ""
  }
  return `${String(parsedYear).padStart(4, "0")}-${String(parsedMonth).padStart(2, "0")}`
}

export function parseMonthInput(value: string) {
  const [year, month] = value.split("-").map(Number)
  if (!isValidPeriod(year, month)) {
    return null
  }
  return { year: String(year), month: String(month) }
}

export function dueDateRange(year: number, month: number) {
  const minimum = new Date(Date.UTC(year, month - 1, 1))
  const maximum = new Date(Date.UTC(year, month, 0))
  let businessDays = 0

  while (businessDays < 7) {
    maximum.setUTCDate(maximum.getUTCDate() + 1)
    const day = maximum.getUTCDay()
    if (day !== 0 && day !== 6) {
      businessDays += 1
    }
  }

  return {
    min: minimum.toISOString().slice(0, 10),
    max: maximum.toISOString().slice(0, 10),
  }
}

export function parseObligationFilters(
  search: string,
  defaultLifecycle: LifecycleFilter,
  fallbackPeriod: { year: number; month: number },
): ObligationFilters {
  const params = new URLSearchParams(search)
  const year = Number(params.get("year"))
  const month = Number(params.get("month"))
  const period = isValidPeriod(year, month)
    ? { year, month }
    : fallbackPeriod
  const lifecycleParam = params.get("lifecycle") as LifecycleFilter | null

  return {
    year: String(period.year),
    month: String(period.month),
    filterByPeriod: params.get("period") !== "all",
    categoryCode: (params.get("category") ?? "").toUpperCase().slice(0, 4),
    lifecycle:
      lifecycleParam !== null && lifecycleOptions.includes(lifecycleParam)
        ? lifecycleParam
        : defaultLifecycle,
  }
}

export function serializeObligationFilters(
  search: string,
  filters: ObligationFilters,
) {
  const params = new URLSearchParams(search)
  params.delete("year")
  params.delete("month")
  params.delete("period")
  params.delete("category")
  params.delete("lifecycle")

  const year = Number(filters.year)
  const month = Number(filters.month)
  if (filters.filterByPeriod && isValidPeriod(year, month)) {
    params.set("year", String(year))
    params.set("month", String(month))
  } else if (!filters.filterByPeriod) {
    params.set("period", "all")
  }
  if (filters.categoryCode) params.set("category", filters.categoryCode)
  if (filters.lifecycle) params.set("lifecycle", filters.lifecycle)

  return params.toString()
}

export function lifecycleFilterLabel(lifecycle: LifecycleFilter) {
  if (lifecycle === "unpaid") return "Unpaid"
  return lifecycle
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

export function canMarkObligationReady(obligation: ObligationPublic) {
  return (
    obligation.lifecycle === "collecting_data" &&
    obligation.current_amount !== null &&
    obligation.due_date !== null &&
    obligation.amount_state !== "unknown" &&
    obligation.due_date_state !== "unknown"
  )
}

export function canEditObligation(obligation: ObligationPublic) {
  return (
    obligation.lifecycle === "draft" ||
    obligation.lifecycle === "collecting_data"
  )
}

export function canCancelObligation(obligation: ObligationPublic) {
  return obligation.lifecycle === "collecting_data"
}

export function canMarkObligationPaid(obligation: ObligationPublic) {
  return obligation.lifecycle === "ready"
}

export function canReopenObligation(obligation: ObligationPublic) {
  return ["ready", "paid", "canceled", "error"].includes(obligation.lifecycle)
}
