import { describe, expect, test } from "bun:test"
import type { ObligationPublic } from "@/client"
import {
  canCancelObligation,
  canEditObligation,
  canMarkObligationPaid,
  canMarkObligationReady,
  canReopenObligation,
  dueDateRange,
  monthInputValue,
  parseMonthInput,
  parseObligationFilters,
  serializeObligationFilters,
} from "./obligationLogic"

function obligation(
  overrides: Partial<ObligationPublic> = {},
): ObligationPublic {
  return {
    lifecycle: "collecting_data",
    current_amount: "100.00",
    due_date: "2026-10-15",
    amount_state: "confirmed",
    due_date_state: "confirmed",
    ...overrides,
  } as ObligationPublic
}

describe("billing periods", () => {
  test("handles year and leap-month boundaries as date-only values", () => {
    expect(dueDateRange(2026, 12)).toEqual({
      min: "2026-12-01",
      max: "2027-01-11",
    })
    expect(dueDateRange(2028, 2)).toEqual({
      min: "2028-02-01",
      max: "2028-03-09",
    })
  })

  test("round-trips month input without timezone conversion", () => {
    expect(parseMonthInput("2026-01")).toEqual({ year: "2026", month: "1" })
    expect(monthInputValue("2026", "1")).toBe("2026-01")
    expect(parseMonthInput("2026-13")).toBeNull()
  })
})

describe("obligation filter query", () => {
  test("round-trips supported filters and preserves unrelated query params", () => {
    const filters = parseObligationFilters(
      "?tab=history&year=2026&month=10&category=ener&lifecycle=collecting_data",
      "unpaid",
      { year: 2026, month: 9 },
    )

    expect(filters).toEqual({
      year: "2026",
      month: "10",
      filterByPeriod: true,
      categoryCode: "ENER",
      lifecycle: "collecting_data",
    })

    const serialized = serializeObligationFilters("?tab=history", filters)
    const params = new URLSearchParams(serialized)
    expect(Object.fromEntries(params)).toEqual({
      tab: "history",
      year: "2026",
      month: "10",
      category: "ENER",
      lifecycle: "collecting_data",
    })
  })

  test("uses safe fallbacks for invalid period and lifecycle values", () => {
    expect(
      parseObligationFilters(
        "?year=2026&month=99&category=abcdef&lifecycle=bogus",
        "unpaid",
        { year: 2026, month: 9 },
      ),
    ).toEqual({
      year: "2026",
      month: "9",
      filterByPeriod: true,
      categoryCode: "ABCD",
      lifecycle: "unpaid",
    })
  })

  test("serializes the all-period state without stale year and month", () => {
    const serialized = serializeObligationFilters(
      "?year=2025&month=12",
      {
        year: "2026",
        month: "10",
        filterByPeriod: false,
        categoryCode: "",
        lifecycle: "",
      },
    )
    expect(serialized).toBe("period=all")
  })
})

describe("obligation action availability", () => {
  test("ready requires complete known amount and due date", () => {
    expect(canMarkObligationReady(obligation())).toBeTrue()
    expect(
      canMarkObligationReady(obligation({ current_amount: null })),
    ).toBeFalse()
    expect(
      canMarkObligationReady(obligation({ amount_state: "unknown" })),
    ).toBeFalse()
    expect(canMarkObligationReady(obligation({ due_date: null }))).toBeFalse()
  })

  test("lifecycle gates edit, cancel, paid and reopen actions", () => {
    expect(canEditObligation(obligation({ lifecycle: "draft" }))).toBeTrue()
    expect(canCancelObligation(obligation())).toBeTrue()
    expect(
      canMarkObligationPaid(obligation({ lifecycle: "ready" })),
    ).toBeTrue()
    expect(canReopenObligation(obligation({ lifecycle: "paid" }))).toBeTrue()
    expect(canReopenObligation(obligation({ lifecycle: "draft" }))).toBeFalse()
  })
})
