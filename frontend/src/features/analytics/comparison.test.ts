import { expect, test } from "bun:test"
import { costChange } from "./comparison"

function total(
  obligation_amount: string | null,
  currency: string | null = "EUR",
) {
  return {
    period: { year: 2026, month: 10 },
    amount: "1.00",
    obligation_amount,
    currency,
    unpriced_component_count: 0,
  }
}
test("compares bill amounts exactly, separately from component sums", () => {
  expect(costChange(total("196.40"), total("208.75"))).toEqual({
    amount: "12.35",
    percentage: 6.29,
    positive: true,
  })
  expect(costChange(total("208.75"), total("196.40"))).toEqual({
    amount: "-12.35",
    percentage: -5.92,
    positive: false,
  })
  expect(
    costChange(total("9999999999999999.99"), total("10000000000000000.01"))
      ?.amount,
  ).toBe("0.02")
})
test("keeps zero baselines and zero changes valid", () => {
  expect(costChange(total("0.00"), total("10.00"))).toEqual({
    amount: "10.00",
    percentage: null,
    positive: true,
  })
  expect(costChange(total("0"), total("0"))).toEqual({
    amount: "0.00",
    percentage: null,
    positive: false,
  })
  expect(costChange(total("10.00"), total("10.00"))).toEqual({
    amount: "0.00",
    percentage: 0,
    positive: false,
  })
})
test("does not invent changes for missing values or currencies", () => {
  for (const [before, after] of [
    [undefined, total("1")],
    [total(null), total("1")],
    [total("1"), total(null)],
    [total("1", "PLN"), total("1", "EUR")],
    [total("1", null), total("2", null)],
  ] as const)
    expect(costChange(before, after)).toBeNull()
})
