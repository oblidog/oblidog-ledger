import { expect, test } from "bun:test"
import {
  formatAmount,
  formatDate,
  formatDateTime,
  formatPercentage,
  formatRegion,
} from "./format"

test("formats exact decimal amounts without losing precision or mixing currencies", () => {
  expect(formatAmount("9007199254740993.1234", "PLN", "en")).toBe(
    "9,007,199,254,740,993.1234 PLN",
  )
  expect(formatAmount("12.3", "EUR", "pl")).toBe("12,30 EUR")
  expect(formatAmount("0.0001", null, "pl")).toBe("0,0001")
  expect(formatAmount("-12", "USD", "en")).toBe("-12.00 USD")
  expect(() => formatAmount("NaN")).toThrow()
})
test("keeps date-only values on their calendar day regardless of timezone", () => {
  expect(
    formatDate(
      "2026-01-01",
      {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        timeZone: "Pacific/Honolulu",
      },
      "en",
    ),
  ).toBe("01/01/2026")
  expect(formatDate("2026-01-01", { month: "long" }, "pl")).toBe("styczeń")
  expect(() => formatDate("2026-02-30")).toThrow()
  expect(() => formatDate("2026-01-01T00:00:00Z")).toThrow()
})
test("formats timestamps, percentages and country names using the chosen locale", () => {
  expect(
    formatDateTime(
      "2026-01-01T23:00:00Z",
      { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Warsaw" },
      "pl",
    ),
  ).toBe("00:00")
  expect(formatPercentage(25, "en")).toBe("25%")
  expect(formatRegion("PL", "pl")).toBe("Polska")
  expect(formatRegion("PL", "en")).toBe("Poland")
})
