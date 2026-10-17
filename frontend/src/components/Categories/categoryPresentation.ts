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
