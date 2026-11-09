import type { CategoryPublic } from "@/client"
import type { CategoryWithCounterparty } from "@/features/counterparties/api"

export function categoryCounterparty(category: CategoryPublic) {
  return (
    (category as CategoryPublic & CategoryWithCounterparty).counterparty ?? null
  )
}

export function recurrencePreset(
  interval: number | undefined,
  unit: "month" | "year" | undefined,
) {
  if (interval === 1 && unit === "month") return "monthly"
  if (interval === 2 && unit === "month") return "every-two-months"
  if (interval === 1 && unit === "year") return "yearly"
  return "custom"
}

// The anchor defines the first billing period. The backend calculates the
// effective due date, which can move into the previous month.
export function firstScheduledPeriod(category: CategoryPublic) {
  if (
    category.data_source_policy === "manual" ||
    !category.first_due_date ||
    !category.recurrence_interval ||
    !category.recurrence_unit
  ) {
    return null
  }
  const [year, month] = category.first_due_date.split("-").map(Number)
  return { year, month }
}

export function firstScheduledPaymentSearch(
  categoryCode: string,
  period: { year: number; month: number },
  allPeriods: boolean,
) {
  return {
    ...(allPeriods ? { period: "all", lifecycle: "" } : period),
    category: categoryCode,
    firstPayment: categoryCode,
  }
}
