import { describe, expect, test } from "bun:test"
import type { ObligationPublic } from "@/client"
import {
  canCancelObligation,
  canEditObligation,
  canMarkObligationPaid,
  canMarkObligationReady,
  canReopenObligation,
  dueDateRange,
  isValidPeriod,
  matchingCategories,
  maxSelectedPeriods,
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
  test.each([1970, 2199])("accepts both boundary months in %i", (year) => {
    for (const month of [1, 12]) {
      expect(isValidPeriod(year, month)).toBe(true)
      const input = `${year}-${String(month).padStart(2, "0")}`
      expect(parseMonthInput(input)).toEqual({
        year: String(year),
        month: String(month),
      })
      expect(monthInputValue(String(year), String(month))).toBe(input)
    }
  })

  test.each([1, 999, 1969, 2200, 9999])(
    "rejects unsupported year %i",
    (year) => {
      expect(isValidPeriod(year, 1)).toBe(false)
      expect(parseMonthInput(`${String(year).padStart(4, "0")}-01`)).toBeNull()
      expect(monthInputValue(String(year), "1")).toBe("")
    },
  )

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
      periods: ["2026-10"],
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
      periods: ["2026-09"],
      categoryCode: "ABCD",
      lifecycle: "unpaid",
    })
  })

  test("round-trips non-consecutive months and keeps other filters", () => {
    const filters = parseObligationFilters(
      "?periods=2026-09&periods=2026-11&category=ener&lifecycle=ready",
      "unpaid",
      { year: 2026, month: 10 },
    )
    expect(filters.periods).toEqual(["2026-09", "2026-11"])
    expect(filters.categoryCode).toBe("ENER")
    const serialized = serializeObligationFilters("", filters)
    expect(new URLSearchParams(serialized).getAll("periods")).toEqual([
      "2026-09",
      "2026-11",
    ])
    expect(
      parseObligationFilters(`?${serialized}`, "unpaid", {
        year: 2026,
        month: 10,
      }).periods,
    ).toEqual(["2026-09", "2026-11"])
  })

  test("normalizes repeated periods and keeps bookmarked selections within the API limit", () => {
    const query = new URLSearchParams()
    for (let year = 2000; year <= 2024; year += 1) {
      query.append("periods", `${year}-01`)
    }
    query.append("periods", "0000-01")
    query.append("periods", "2000-01")
    const fallback = { year: 2026, month: 10 }
    const { periods } = parseObligationFilters(query.toString(), "", fallback)
    expect(periods).toHaveLength(maxSelectedPeriods)
    expect(periods[0]).toBe("2000-01")
    expect(periods[periods.length - 1]).toBe("2023-01")
    expect(
      parseObligationFilters("?periods=0000-01", "", fallback).periods,
    ).toEqual(["2026-10"])
  })

  test("serializes the all-period state without stale year and month", () => {
    const serialized = serializeObligationFilters("?year=2025&month=12", {
      periods: [],
      categoryCode: "",
      lifecycle: "",
    })
    expect(serialized).toBe("period=all&lifecycle=")
    expect(
      parseObligationFilters(`?${serialized}`, "unpaid", {
        year: 2026,
        month: 10,
      }).lifecycle,
    ).toBe("")
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

  test("complete drafts can be confirmed without editing, including zero amounts", () => {
    expect(
      canMarkObligationReady(
        obligation({
          lifecycle: "draft",
          current_amount: "0.00",
          amount_state: "estimated",
          due_date_state: "estimated",
        }),
      ),
    ).toBeTrue()
    for (const overrides of [
      { current_amount: null },
      { due_date: null },
      { amount_state: "unknown" as const },
      { due_date_state: "unknown" as const },
    ]) {
      expect(
        canMarkObligationReady(
          obligation({ lifecycle: "draft", ...overrides }),
        ),
      ).toBeFalse()
    }
    for (const lifecycle of ["ready", "paid", "canceled", "error"] as const) {
      expect(canMarkObligationReady(obligation({ lifecycle }))).toBeFalse()
    }
  })

  test("lifecycle gates edit, cancel, paid and reopen actions", () => {
    expect(canEditObligation(obligation({ lifecycle: "draft" }))).toBeTrue()
    expect(canCancelObligation(obligation())).toBeTrue()
    expect(canMarkObligationPaid(obligation({ lifecycle: "ready" }))).toBeTrue()
    expect(canReopenObligation(obligation({ lifecycle: "paid" }))).toBeTrue()
    expect(canReopenObligation(obligation({ lifecycle: "draft" }))).toBeFalse()
  })
})

test("category search matches human names and optional codes without mutating the source", () => {
  const categories = [
    { name: "Prąd — opłata stała", code: "ELEC" },
    { name: "Wasser", code: "WATR" },
  ]
  expect(matchingCategories(categories, "oplata")).toEqual([categories[0]])
  expect(matchingCategories(categories, "elec")).toEqual([categories[0]])
  expect(matchingCategories(categories, " wasser ")).toEqual([categories[1]])
  expect(matchingCategories(categories, "missing")).toEqual([])
  expect(matchingCategories(categories, "")).toEqual(categories)
})
