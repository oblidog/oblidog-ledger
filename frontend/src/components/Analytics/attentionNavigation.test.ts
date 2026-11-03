import { expect, test } from "bun:test"
import {
  parseObligationFilters,
  serializeObligationFilters,
} from "../Obligations/obligationLogic"
import {
  attentionObligationHref,
  unpaidObligationsHref,
} from "./attentionNavigation"

test("unpaid navigation overrides demo defaults, keeps period and exposes removable filter", () => {
  const url = new URL(
    unpaidObligationsHref("home", { year: 2026, month: 11 }),
    "https://example.test",
  )
  const filters = parseObligationFilters(url.search, "", {
    year: 2027,
    month: 1,
  })
  expect(filters).toMatchObject({
    lifecycle: "unpaid",
    year: "2026",
    month: "11",
    filterByPeriod: true,
  })
  const cleared = serializeObligationFilters(url.search, {
    ...filters,
    lifecycle: "",
  })
  expect(
    parseObligationFilters(cleared, "unpaid", { year: 2027, month: 1 })
      .lifecycle,
  ).toBe("")
})

test("attention target uses its own earlier period instead of the dashboard month", () => {
  const url = new URL(
    attentionObligationHref("home", {
      year: 2026,
      month: 10,
      category_code: "HOME",
    }),
    "https://example.test",
  )
  expect(
    parseObligationFilters(url.search, "", { year: 2026, month: 11 }),
  ).toMatchObject({
    year: "2026",
    month: "10",
    categoryCode: "HOME",
    lifecycle: "unpaid",
  })
})
