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
  const ledger = await createCategoryHistoryFixture()

  await page.addInitScript(() => localStorage.setItem("vite-ui-theme", "light"))
  await page.goto(`/ledgers/${ledger.id}/analytics`)

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
    const ledger = await createCategoryHistoryFixture()
    await page.setViewportSize({ width, height: 844 })
    await page.goto(`/ledgers/${ledger.id}/analytics`)

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
  const ledger = await createCategoryHistoryFixture()
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

  await page.goto(`/ledgers/${ledger.id}/analytics`)

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
