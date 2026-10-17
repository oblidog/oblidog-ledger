import { describe, expect, test } from "bun:test"
import type { ObligationPublic } from "@/client"
import { i18n } from "@/i18n"
import {
  businessDaysUntil,
  dueDateStatusClasses,
  visibleObligationRows,
} from "./obligationPresentation"

const row = (
  key: string,
  lifecycle: ObligationPublic["lifecycle"],
  due_date: string | null,
) => ({ key, lifecycle, due_date }) as ObligationPublic

describe("obligation presentation", () => {
  test("unpaid rows exclude paid/canceled, put unknown dates first and preserve cached order", () => {
    const rows = [
      row("paid", "paid", "2026-10-01"),
      row("late", "ready", "2026-10-20"),
      row("unknown", "draft", null),
      row("canceled", "canceled", null),
      row("early", "ready", "2026-10-15"),
    ]
    expect(visibleObligationRows(rows, "unpaid")?.map((r) => r.key)).toEqual([
      "unknown",
      "early",
      "late",
    ])
    expect(visibleObligationRows(rows, "")?.map((r) => r.key)).toEqual([
      "unknown",
      "canceled",
      "paid",
      "early",
      "late",
    ])
    expect(rows.map((r) => r.key)).toEqual([
      "paid",
      "late",
      "unknown",
      "canceled",
      "early",
    ])
    expect(visibleObligationRows(undefined, "unpaid")).toBeUndefined()
  })
  test("due-date badges preserve weekend counting and urgency boundaries", () => {
    const friday = new Date(2026, 9, 16, 12)
    expect(businessDaysUntil(null, friday).className).toBe(
      dueDateStatusClasses.unknown,
    )
    expect(businessDaysUntil("2026-10-15", friday).label).toBe(
      i18n.t("app:obligations.overdue"),
    )
    expect(businessDaysUntil("2026-10-19", friday).label).toBe(
      i18n.t("app:messages.business_days", { count: 1 }),
    )
    expect(businessDaysUntil("2026-10-20", friday).isUrgent).toBe(true)
    expect(businessDaysUntil("2026-10-23", friday).className).toBe(
      dueDateStatusClasses.soon,
    )
    expect(businessDaysUntil("2026-10-26", friday).className).toBe(
      dueDateStatusClasses.safe,
    )
  })
})
