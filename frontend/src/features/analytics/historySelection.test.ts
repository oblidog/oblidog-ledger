import { expect, test } from "bun:test"
import type { AvailableHistoryPeriod } from "./componentHistoryApi"
import { defaultHistoryCategoryId } from "./historySelection"

const categories = [{ id: "a" }, { id: "b" }]
const period = (
  category_id: string,
  month: number,
  has_components: boolean,
  year = 2026,
): AvailableHistoryPeriod => ({
  category_id,
  period: { year, month },
  has_components,
})

test("prefers component history visible in the latest six recorded periods", () => {
  const history = [
    ...Array.from({ length: 7 }, (_, index) =>
      period("a", index + 1, index === 0),
    ),
    period("b", 7, true),
  ]
  expect(defaultHistoryCategoryId(categories, history)).toBe("b")
  expect(defaultHistoryCategoryId(categories, [...history].reverse())).toBe("b")
  // The six-period boundary is inclusive, so an accessible component wins.
  expect(
    defaultHistoryCategoryId(
      categories,
      history.filter(
        (item) => !(item.category_id === "a" && item.period.month === 7),
      ),
    ),
  ).toBe("a")
})

test("counts actual records across year boundaries and long calendar gaps", () => {
  const history = [
    period("a", 12, true, 2020),
    period("a", 10, false),
    period("b", 10, true),
  ]
  expect(defaultHistoryCategoryId(categories, history)).toBe("a")
  expect(history[0].period.year).toBe(2020)
})

test("falls back to older component history, then bill records, then the first category", () => {
  expect(
    defaultHistoryCategoryId(categories, [
      period("b", 1, true),
      ...Array.from({ length: 6 }, (_, i) => period("b", i + 2, false)),
    ]),
  ).toBe("b")
  expect(defaultHistoryCategoryId(categories, [period("b", 10, false)])).toBe(
    "b",
  )
  expect(defaultHistoryCategoryId(categories, [])).toBe("a")
  expect(defaultHistoryCategoryId([], [period("b", 10, true)])).toBeUndefined()
  expect(
    defaultHistoryCategoryId(categories, [period("archived", 10, true)]),
  ).toBe("a")
})
