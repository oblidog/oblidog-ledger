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

for (const width of [320, 375, 414]) {
  test(`keeps analytics charts readable at ${width}px`, async ({
    page,
  }) => {
    const ledger = await createCategoryHistoryFixture()
    await page.setViewportSize({ width, height: 844 })
    await page.goto(`/ledgers/${ledger.id}/analytics`)

    const charts = [
      page.getByTestId("payment-schedule-chart"),
      page.getByTestId("period-totals-chart"),
      page.getByTestId("category-history-chart"),
    ]

    for (const chart of charts) {
      await expect(chart).toBeVisible()
      await expect(chart.locator("svg")).toBeVisible()
      await expect(chart.locator(".recharts-yAxis")).toBeVisible()
      await expect
        .poll(() =>
          chart.evaluate(
            (element) => element.scrollWidth <= element.clientWidth,
          ),
        )
        .toBe(true)
    }

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
