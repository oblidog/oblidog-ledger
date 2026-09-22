import { expect, test } from "@playwright/test"

import {
  CategoriesService,
  client,
  LedgersService,
  LoginService,
  ObligationsService,
} from "../src/client"
import { firstSuperuser, firstSuperuserPassword } from "./config.ts"

async function createCategoryHistoryFixture() {
  client.setConfig({
    baseURL: process.env.VITE_API_URL ?? "http://localhost:8000",
  })
  const token = await LoginService.loginAccessToken({
    formData: {
      username: firstSuperuser,
      password: firstSuperuserPassword,
    },
  })
  client.setConfig({ auth: token.access_token })

  const ledger = await LedgersService.createLedger({
    requestBody: { name: `Category history ${Date.now()}` },
  })
  const group = await CategoriesService.createCategoryGroup({
    ledgerId: ledger.id,
    requestBody: { name: "Utilities" },
  })
  await CategoriesService.createCategory({
    ledgerId: ledger.id,
    requestBody: {
      category_group_id: group.id,
      name: "Water",
      code: "WATR",
      data_source_policy: "hybrid",
    },
  })

  const now = new Date()
  await ObligationsService.createObligation({
    ledgerId: ledger.id,
    requestBody: {
      category_code: "WATR",
      period: { year: now.getFullYear(), month: now.getMonth() + 1 },
      current_amount: "42.00",
      due_date: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`,
    },
  })

  return ledger
}

function addMonths(offset: number) {
  const now = new Date()
  const date = new Date(now.getFullYear(), now.getMonth() + offset, 1)
  return { year: date.getFullYear(), month: date.getMonth() + 1 }
}

function periodLabel(period: { year: number; month: number }) {
  return new Intl.DateTimeFormat("en-GB", {
    month: "short",
    year: "numeric",
  }).format(new Date(period.year, period.month - 1, 1))
}

async function periodTotalsBarFill(page: import("@playwright/test").Page) {
  const chart = page.getByTestId("period-totals-chart")
  const bar = chart.locator(".recharts-bar-rectangle path").first()

  await expect(bar).toBeVisible()
  await expect(bar).toHaveAttribute("fill", "var(--color-amount)")
  await bar.hover()
  await expect(chart.locator(".recharts-tooltip-wrapper")).toBeVisible()

  return bar.evaluate((element) => getComputedStyle(element).fill)
}

test("uses a theme-aware color for period total bars", async ({ page }) => {
  await createCategoryHistoryFixture()

  await page.addInitScript(() => localStorage.setItem("vite-ui-theme", "light"))
  await page.goto("/")

  await expect(page.locator("html")).toHaveClass(/light/)
  const lightFill = await periodTotalsBarFill(page)

  await page.getByTestId("theme-button").click()
  await page.getByTestId("dark-mode").click()
  await expect(page.locator("html")).toHaveClass(/dark/)
  const darkFill = await periodTotalsBarFill(page)

  expect(lightFill).not.toBe("rgb(0, 0, 0)")
  expect(darkFill).not.toBe("rgb(0, 0, 0)")
  expect(darkFill).not.toBe(lightFill)
})

for (const width of [320, 375, 414]) {
  test(`keeps analytics charts readable at ${width}px`, async ({ page }) => {
    await createCategoryHistoryFixture()
    await page.setViewportSize({ width, height: 844 })
    await page.goto("/")

    const charts = [
      {
        axisLabel: "Amount",
        chart: page.getByTestId("payment-schedule-chart"),
      },
      { axisLabel: "Total", chart: page.getByTestId("period-totals-chart") },
      {
        axisLabel: "Amount",
        chart: page.getByTestId("category-history-chart"),
      },
    ]

    for (const { axisLabel, chart } of charts) {
      await expect(chart).toBeVisible()
      await expect(chart.locator("svg")).toBeVisible()
      await expect(chart.getByText(axisLabel, { exact: true })).toBeVisible()
      await expect
        .poll(() =>
          chart.evaluate(
            (element) => element.scrollWidth <= element.clientWidth,
          ),
        )
        .toBe(true)
    }

    const categoryCosts = page.getByRole("region", {
      name: "Category costs in PLN",
    })
    const donut = categoryCosts.getByTestId("category-cost-donut")
    await expect(donut).toBeVisible()
    await expect(donut.locator("svg")).toBeVisible()
    await expect(donut.locator(".recharts-sector")).toBeVisible()
    await expect(
      categoryCosts.getByText("Water", { exact: true }),
    ).toBeVisible()
    await expect(
      categoryCosts.getByText("42.00 PLN", { exact: true }),
    ).toBeVisible()
    await expect
      .poll(() =>
        donut.evaluate((element) => element.scrollWidth <= element.clientWidth),
      )
      .toBe(true)

    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      )
      .toBe(true)

    await expect(
      page.getByTestId("period-totals-chart").getByText("42"),
    ).toBeVisible()
    await expect(
      page.getByTestId("category-history-chart").getByText("42"),
    ).toBeVisible()
  })
}

test("shows amount progress as the primary payment metric", async ({
  page,
}) => {
  await createCategoryHistoryFixture()
  await page.route("**/analytics/period-summary?**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        period: {
          year: new Date().getFullYear(),
          month: new Date().getMonth() + 1,
        },
        total_obligation_count: 2,
        paid_obligation_count: 1,
        paid_percentage: "50",
        unknown_amount_count: 0,
        is_complete: true,
        amount_summaries: [
          {
            currency: "PLN",
            total_known_amount: "100.00",
            paid_known_amount: "10.00",
            paid_percentage: "10",
          },
        ],
      },
    })
  })

  await page.goto("/")

  const progress = page.getByRole("region", {
    name: "Payment progress in PLN",
  })
  await expect(progress.getByText("10%", { exact: true })).toBeVisible()
  await expect(
    progress.getByText("10.00 PLN / 100.00 PLN", { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByText("1 of 2 obligations paid", { exact: true }),
  ).toBeVisible()
})

test("compares stable, added, removed and renamed components across six periods", async ({
  page,
}) => {
  const ledger = await createCategoryHistoryFixture()
  const current = addMonths(0)
  const previous = addMonths(-1)
  const earlier = addMonths(-2)

  const currentObligations = await ObligationsService.readObligations({
    ledgerId: ledger.id,
    year: current.year,
    month: current.month,
    categoryCode: "WATR",
  })
  const currentObligation = currentObligations.data[0]

  const earlierObligation = await ObligationsService.createObligation({
    ledgerId: ledger.id,
    requestBody: {
      category_code: "WATR",
      period: earlier,
    },
  })
  const previousObligation = await ObligationsService.createObligation({
    ledgerId: ledger.id,
    requestBody: {
      category_code: "WATR",
      period: previous,
    },
  })

  for (const [obligationKey, baseLabel, baseAmount, legacyAmount] of [
    [earlierObligation.key, "Base charge", "10.00", "5.00"],
    [previousObligation.key, "Base charge", "11.00", "6.00"],
  ] as const) {
    await ObligationsService.addObligationComponent({
      ledgerId: ledger.id,
      obligationKey,
      requestBody: {
        type: "invoice_item",
        label: baseLabel,
        amount: baseAmount,
        source: "provider",
        external_id: "base",
      },
    })
    await ObligationsService.addObligationComponent({
      ledgerId: ledger.id,
      obligationKey,
      requestBody: {
        type: "invoice_item",
        label: "Legacy fee",
        amount: legacyAmount,
        source: "provider",
        external_id: "legacy",
      },
    })
  }

  await ObligationsService.addObligationComponent({
    ledgerId: ledger.id,
    obligationKey: previousObligation.key,
    requestBody: {
      type: "adjustment",
      label: "New discount",
      amount: "2.00",
      source: "provider",
      external_id: "new",
    },
  })
  await ObligationsService.addObligationComponent({
    ledgerId: ledger.id,
    obligationKey: currentObligation.key,
    requestBody: {
      type: "invoice_item",
      label: "Base charge renamed",
      amount: "0.00",
      source: "provider",
      external_id: "base",
    },
  })
  await ObligationsService.addObligationComponent({
    ledgerId: ledger.id,
    obligationKey: currentObligation.key,
    requestBody: {
      type: "adjustment",
      label: "New discount",
      source: "provider",
      external_id: "new",
    },
  })

  await page.goto(`/ledgers/${ledger.id}/analytics`)

  await expect(page.getByRole("link", { name: "Analytics" })).toBeVisible()
  await expect(
    page.getByRole("heading", { name: "More insights are on the way" }),
  ).toBeVisible()
  await expect(page.getByText("Planned", { exact: true })).toHaveCount(3)

  await page.getByRole("combobox", { name: "Compare by" }).click()
  await page.getByRole("option", { name: "External ID" }).click()

  const table = page.getByTestId("component-history-table")
  await expect(table).toBeVisible()
  await expect(
    table.getByText("Base charge renamed", { exact: true }),
  ).toBeVisible()
  await expect(
    table.getByText("Previously: Base charge", { exact: true }),
  ).toBeVisible()

  const earlierRow = table
    .getByRole("row")
    .filter({ hasText: periodLabel(earlier) })
  await expect(earlierRow).toContainText("10.00 PLN")
  await expect(earlierRow).toContainText("5.00 PLN")

  const previousRow = table
    .getByRole("row")
    .filter({ hasText: periodLabel(previous) })
  await expect(previousRow).toContainText("11.00 PLN")
  await expect(previousRow).toContainText("2.00 PLN")
  await expect(previousRow.getByText("Added", { exact: true })).toBeVisible()

  const currentRow = table
    .getByRole("row")
    .filter({ hasText: periodLabel(current) })
  await expect(currentRow).toContainText("0.00 PLN")
  await expect(currentRow).toContainText("Present")
  await expect(currentRow.getByText("Removed", { exact: true })).toBeVisible()
  await expect(currentRow).toContainText("0.00 PLN")

  await expect(table.getByRole("row")).toHaveCount(7)
})

test("shows component history endpoint errors and allows changing criterion", async ({
  page,
}) => {
  const ledger = await createCategoryHistoryFixture()
  let requestedMatchBy: string | undefined

  await page.route("**/analytics/component-history?**", async (route) => {
    const url = new URL(route.request().url())
    requestedMatchBy = url.searchParams.get("match_by") ?? undefined
    await route.fulfill({
      status: 422,
      contentType: "application/json",
      json: {
        detail:
          "Ambiguous component identity 'fee:service fee'; select another matching criterion",
      },
    })
  })

  await page.goto(`/ledgers/${ledger.id}/analytics`)

  await expect.poll(() => requestedMatchBy).toBe("label")
  await expect(
    page.getByText("Component history is unavailable", { exact: true }),
  ).toBeVisible()

  await page.getByRole("combobox", { name: "Compare by" }).click()
  await page.getByRole("option", { name: "External ID" }).click()

  await expect.poll(() => requestedMatchBy).toBe("external_id")
})
