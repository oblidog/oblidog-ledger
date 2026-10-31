import type { AvailableHistoryPeriod } from "./componentHistoryApi"

export const HISTORY_PAGE_SIZE = 6

// Match the recorded-period window requested by the table, independent of API order.
export function defaultHistoryCategoryId(
  categories: { id: string }[],
  history: AvailableHistoryPeriod[],
) {
  const byCategory = new Map<string, AvailableHistoryPeriod[]>()
  for (const item of history) {
    const periods = byCategory.get(item.category_id) ?? []
    periods.push(item)
    byCategory.set(item.category_id, periods)
  }
  for (const periods of byCategory.values()) {
    periods.sort(
      (a, b) =>
        b.period.year - a.period.year || b.period.month - a.period.month,
    )
  }
  return (
    categories.find((category) =>
      byCategory
        .get(category.id)
        ?.slice(0, HISTORY_PAGE_SIZE)
        .some((item) => item.has_components),
    )?.id ??
    categories.find((category) =>
      byCategory.get(category.id)?.some((item) => item.has_components),
    )?.id ??
    categories.find((category) => byCategory.has(category.id))?.id ??
    categories[0]?.id
  )
}
