export function unpaidObligationsHref(
  ledgerId: string,
  period: { year: number; month: number },
) {
  return `/ledgers/${ledgerId}?year=${period.year}&month=${period.month}&lifecycle=unpaid`
}

export function attentionObligationHref(
  ledgerId: string,
  item: {
    year?: number | null
    month?: number | null
    category_code?: string | null
  },
) {
  return `${unpaidObligationsHref(ledgerId, { year: item.year!, month: item.month! })}&category=${encodeURIComponent(item.category_code!)}`
}
