import { expect, type Page, test } from "@playwright/test"

const ledgerId = "11111111-1111-4111-8111-111111111111"
const userId = "22222222-2222-4222-8222-222222222222"
const categoryId = "33333333-3333-4333-8333-333333333333"
const emptyId = "44444444-4444-4444-8444-444444444444"
const periods = [1, 2, 3, 4, 5, 7, 10].map((month) => ({ year: 2026, month }))
test.use({ storageState: { cookies: [], origins: [] } })

async function api(
  page: Page,
  language = "en",
  theme = "light",
  amounts: (string | null)[] = ["196.40", "208.75"],
  currencies = ["EUR", "EUR"],
) {
  const historyRequests: URL[] = []
  await page.addInitScript(
    ({ language, theme }) => {
      localStorage.setItem("oblidog-language", language)
      localStorage.setItem("vite-ui-theme", theme)
    },
    { language, theme },
  )
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname.replace(/\/$/, "")
    const send = (json: unknown) => route.fulfill({ json })
    if (route.request().method() === "OPTIONS") return send({})
    if (path.endsWith("/utils/public-config"))
      return send({
        environment: "demo",
        is_demo: true,
        demo_writes_enabled: true,
        demo_credentials: null,
      })
    if (path.endsWith("/users/me"))
      return send({
        id: userId,
        email: "demo@oblidog.com",
        is_active: true,
        is_superuser: false,
        language: "en",
      })
    const ledger = {
      id: ledgerId,
      owner_user_id: userId,
      name: "Home",
      is_active: true,
      default_currency: "EUR",
      business_calendar_country: "PL",
      created_at: "2026-01-01T00:00:00Z",
    }
    if (path === "/api/v1/ledgers") return send({ data: [ledger], count: 1 })
    if (path === `/api/v1/ledgers/${ledgerId}`) return send(ledger)
    if (path.endsWith("/categories"))
      return send({
        data: [
          {
            id: emptyId,
            name: "Car insurance",
            code: "AUTO",
            currency: "EUR",
            is_active: true,
          },
          {
            id: categoryId,
            name: "Electricity",
            code: "ELEC",
            currency: "EUR",
            is_active: true,
          },
        ],
        count: 2,
      })
    if (path.endsWith("/history-periods"))
      return send(
        periods.map((period) => ({
          category_id: categoryId,
          period,
          has_components: true,
        })),
      )
    if (path.endsWith("/component-history")) {
      historyRequests.push(url)
      expect(url.searchParams.get("available_only")).toBe("true")
      const endMonth = Number(url.searchParams.get("end_month"))
      const shown = periods.filter((p) => p.month <= endMonth).slice(-6)
      const totals = shown.map((period, index) => ({
        period,
        amount: index === shown.length - 1 ? "8.00" : "7.00",
        obligation_amount: index === shown.length - 1 ? amounts[1] : amounts[0],
        currency: index === shown.length - 1 ? currencies[1] : currencies[0],
        unpriced_component_count: 0,
      }))
      return send({
        match_by: "label",
        periods: shown,
        totals,
        components: [
          {
            identity: "fee:energy",
            label: "Energy charge",
            type: "fee",
            source: "provider",
            external_id: "technical-123",
            values: totals.map((t) => ({
              period: t.period,
              amount: t.amount,
              state: "present",
              label: "Energy charge",
              source: "provider",
              external_id: "technical-123",
            })),
          },
        ],
      })
    }
    return send({ data: [], count: 0 })
  })
  return historyRequests
}

for (const language of ["en", "pl", "de"]) {
  for (const theme of ["light", "dark"]) {
    test(`${language} ${theme}: real periods, bill comparison, keyboard details and mobile layout`, async ({
      page,
    }, testInfo) => {
      const requests = await api(page, language, theme)
      await page.goto(`/ledgers/${ledgerId}/analytics`)
      const table = page.getByTestId("component-history-table")
      await expect(table).toBeVisible()
      expect(requests[0].searchParams.get("category_id")).toBe(categoryId)
      await expect(table.getByRole("row")).toHaveCount(7)
      await expect(
        page.getByText("technical-123", { exact: false }),
      ).toBeHidden()
      const details = table.locator("summary").first()
      await details.focus()
      await page.keyboard.press("Enter")
      await expect(
        table.getByText("provider · technical-123", { exact: true }),
      ).toBeVisible()
      const comparison = page.getByTestId("cost-comparison")
      await expect(comparison).toContainText(
        language === "en" ? "+12.35 EUR" : "+12,35 EUR",
      )
      await expect(comparison).toContainText(
        language === "en" ? "196.40 EUR" : "196,40 EUR",
      )
      await expect(comparison).not.toContainText("8.00")
      const range = page.getByRole("combobox", {
        name:
          language === "en"
            ? "Range ending"
            : language === "pl"
              ? "Koniec zakresu"
              : "Bereich endet am",
        exact: true,
      })
      await range.click()
      await expect(page.getByRole("option")).toHaveCount(7)
      await page.keyboard.press("Escape")
      await expect(page.locator("html")).toHaveClass(new RegExp(theme))
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true)
      await page.screenshot({
        path: `/tmp/analytics-${language}-${theme}-${testInfo.project.name}.png`,
        fullPage: true,
      })
    })
  }
}

test("keeps explicit empty selections across refetches and pages through older records", async ({
  page,
}) => {
  await api(page)
  await page.goto(`/ledgers/${ledgerId}/analytics`)
  const table = page.getByTestId("component-history-table")
  await expect(table).toBeVisible()
  await page.getByRole("button", { name: "Show older periods" }).click()
  await expect(table.getByRole("row")).toHaveCount(2)
  await expect(page.getByTestId("cost-comparison")).toContainText(
    "One recorded period",
  )
  await expect(
    page.getByRole("button", { name: "Show older periods" }),
  ).toHaveCount(0)
  await page.getByRole("combobox", { name: "Category", exact: true }).click()
  await page.getByRole("option", { name: "Car insurance" }).click()
  await expect(page.getByText(/No recorded periods/)).toBeVisible()
  await page.evaluate(() => {
    window.dispatchEvent(new Event("blur"))
    window.dispatchEvent(new Event("focus"))
    document.dispatchEvent(new Event("visibilitychange"))
  })
  await expect(
    page.getByRole("combobox", { name: "Category", exact: true }),
  ).toContainText("Car insurance")
  await expect(table).toHaveCount(0)
})

for (const [label, amounts, currencies] of [
  ["zero baseline", ["0.00", "10.00"], ["EUR", "EUR"]],
  ["unknown amount", ["10.00", null], ["EUR", "EUR"]],
  ["changed currency", ["10.00", "20.00"], ["PLN", "EUR"]],
] as const) {
  test(`comparison handles ${label}`, async ({ page }) => {
    await api(page, "en", "light", [...amounts], [...currencies])
    await page.goto(`/ledgers/${ledgerId}/analytics`)
    const comparison = page.getByTestId("cost-comparison")
    await expect(comparison).toBeVisible()
    if (label === "zero baseline") {
      await expect(comparison).toContainText("+10.00 EUR")
      await expect(comparison).not.toContainText("%")
    } else {
      await expect(comparison).toContainText("Change is unavailable")
      await expect(comparison).not.toContainText("%")
    }
  })
}

test("prefers visible history over older hidden components, while preserving deliberate selection", async ({
  page,
}) => {
  const requests = await api(page)
  let catalogRequests = 0
  await page.route("**/analytics/history-periods", (route) => {
    catalogRequests++
    return route.fulfill({
      json: [
        ...Array.from({ length: 7 }, (_, i) => ({
          category_id: emptyId,
          period: { year: 2026, month: i + 1 },
          has_components: i === 0,
        })),
        ...periods.map((period) => ({
          category_id: categoryId,
          period,
          has_components: true,
        })),
      ],
    })
  })
  await page.goto(`/ledgers/${ledgerId}/analytics`)
  await expect(page.getByTestId("component-history-table")).toBeVisible()
  expect(requests[0].searchParams.get("category_id")).toBe(categoryId)
  await page.getByRole("combobox", { name: "Category", exact: true }).click()
  await page.getByRole("option", { name: "Car insurance" }).click()
  await expect
    .poll(() => requests[requests.length - 1].searchParams.get("category_id"))
    .toBe(emptyId)
  const previousRequests = catalogRequests
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  )
  await expect.poll(() => catalogRequests).toBeGreaterThan(previousRequests)
  await expect(
    page.getByRole("combobox", { name: "Category", exact: true }),
  ).toContainText("Car insurance")
})

test("informational components have no unknown-amount warning while unknown bill amounts remain explicit", async ({
  page,
}) => {
  await api(page)
  await page.route("**/analytics/component-history?**", (route) =>
    route.fulfill({
      json: {
        match_by: "label",
        periods: [{ year: 2026, month: 10 }],
        totals: [
          {
            period: { year: 2026, month: 10 },
            amount: null,
            obligation_amount: null,
            currency: "EUR",
            unpriced_component_count: 1,
          },
        ],
        components: [
          {
            identity: "lease:apartment",
            label: "Apartment 3B",
            type: "lease",
            source: "demo-seed",
            external_id: "RENT:0",
            values: [
              {
                period: { year: 2026, month: 10 },
                amount: null,
                state: "present",
                label: "Apartment 3B",
                source: "demo-seed",
                external_id: "RENT:0",
              },
            ],
          },
        ],
      },
    }),
  )
  await page.goto(`/ledgers/${ledgerId}/analytics`)
  const table = page.getByTestId("component-history-table")
  await expect(table).toBeVisible()
  await expect(table.getByText("No amount", { exact: true })).toBeVisible()
  await expect(
    table.getByText("Components without an amount are omitted", {
      exact: true,
    }),
  ).toBeVisible()
  await expect(table.getByText("Amount unknown", { exact: true })).toHaveCount(
    0,
  )
  await expect(
    page
      .getByTestId("cost-comparison")
      .getByText("Amount unknown", { exact: true }),
  ).toBeVisible()
})
