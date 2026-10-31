import { expect, type Page, test } from "@playwright/test"
import type { ObligationPublic } from "../src/client"

test.use({ storageState: { cookies: [], origins: [] } })
const ledgerId = "obligations-preview"
const userId = "owner"

function obligation(
  name: string,
  code: string,
  lifecycle: ObligationPublic["lifecycle"],
  amount: string | null,
): ObligationPublic {
  return {
    id: code,
    ledger_id: ledgerId,
    category_id: code,
    counterparty_id: null,
    counterparty: null,
    category_code: code,
    key: `${code}-2026-10`,
    name,
    notes: null,
    lifecycle,
    period: { year: 2026, month: 10 },
    effective_value_source: "manual",
    current_amount: amount,
    amount_state: amount === null ? "unknown" : "confirmed",
    amount_source: "manual",
    issue_date: null,
    issue_date_state: "unknown",
    issue_date_source: "unknown",
    due_date: "2026-10-01",
    due_date_state: "confirmed",
    due_date_source: "manual",
    currency: "EUR",
    paid_at: lifecycle === "paid" ? "2026-10-10T12:00:00Z" : null,
    created_at: "2026-10-01T12:00:00Z",
    updated_at: "2026-10-01T12:00:00Z",
  }
}
const rows = [
  obligation("Electricity", "ELEC", "ready", "208.75"),
  obligation("Water", "WATR", "paid", "39.99"),
  obligation("Internet", "INET", "error", null),
  obligation("Car insurance", "AUTO", "canceled", "150.00"),
  {
    ...obligation("School meals", "MEAL", "collecting_data", null),
    due_date: null,
  },
  { ...obligation("Rent", "RENT", "draft", null), due_date: null },
]
async function api(
  page: Page,
  language = "en",
  theme = "light",
  viewer = false,
  demo = true,
) {
  const requests: URL[] = []
  const writes: string[] = []
  await page.addInitScript(
    ({ language, theme }) => {
      localStorage.setItem("oblidog-language", language)
      localStorage.setItem("vite-ui-theme", theme)
    },
    { language, theme },
  )
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname.replace(/\/$/, "")
    const send = (json: unknown) => route.fulfill({ json })
    if (request.method() === "OPTIONS") return send({})
    if (request.method() !== "GET") writes.push(path)
    if (path.endsWith("/utils/public-config"))
      return send({
        environment: demo ? "demo" : "local",
        is_demo: demo,
        demo_writes_enabled: true,
        demo_credentials: null,
      })
    if (path.endsWith("/users/me"))
      return send({
        id: viewer ? "viewer" : userId,
        email: "demo@oblidog.com",
        full_name: "Demo",
        is_active: true,
        is_superuser: false,
        language: "en",
      })
    const ledger = {
      id: ledgerId,
      owner_user_id: userId,
      name: "Home",
      description: null,
      is_active: true,
      default_currency: "EUR",
      business_calendar_country: "PL",
      created_at: "2026-01-01T00:00:00Z",
    }
    if (path === "/api/v1/ledgers") return send({ data: [ledger], count: 1 })
    if (path === `/api/v1/ledgers/${ledgerId}`) return send(ledger)
    if (path.endsWith("/members"))
      return send({
        data: viewer ? [{ user_id: "viewer", role: "viewer" }] : [],
        count: viewer ? 1 : 0,
      })
    if (path.endsWith("/categories"))
      return send({
        data: rows.map((row) => ({
          id: row.category_id,
          name: row.name,
          code: row.category_code,
          is_active: true,
        })),
        count: rows.length,
      })
    if (path.endsWith("/obligations")) {
      requests.push(url)
      const data = rows.filter(
        (row) =>
          (!url.searchParams.get("category_code") ||
            row.category_code === url.searchParams.get("category_code")) &&
          (!url.searchParams.get("lifecycle") ||
            row.lifecycle === url.searchParams.get("lifecycle")),
      )
      return send({ data, count: data.length })
    }
    if (path.endsWith("/actions") || path.endsWith("/components"))
      return send({ data: [], count: 0 })
    const row = rows.find((item) => path.endsWith(`/obligations/${item.key}`))
    if (row) return send(row)
    return send({ data: [], count: 0 })
  })
  return { requests, writes }
}

for (const language of ["en", "pl", "de"]) {
  for (const theme of ["light", "dark"]) {
    test(`${language} ${theme}: neutral settled items, explicit errors and responsive list`, async ({
      page,
    }, info) => {
      const { writes } = await api(page, language, theme)
      await page.goto(`/ledgers/${ledgerId}?period=all&lifecycle=`)
      const mobile = info.project.name === "mobile"
      await expect(
        page.getByTestId(mobile ? "obligation-card" : "obligation-row"),
      ).toHaveCount(6)
      await expect(
        page.getByTestId(mobile ? "obligation-list" : "obligation-card"),
      ).toHaveCount(0)
      const item = (name: string) =>
        page
          .getByTestId(mobile ? "obligation-card" : "obligation-row")
          .filter({ hasText: name })
      await expect(item("Water")).not.toHaveClass(/bg-emerald|bg-destructive/)
      await expect(item("Car insurance")).not.toHaveClass(/bg-destructive/)
      await expect(item("Internet")).toHaveClass(/bg-destructive/)
      await expect(item("Electricity")).toHaveClass(/bg-destructive/)
      await expect(item("School meals")).toContainText(
        language === "en"
          ? "Amount unknown"
          : language === "pl"
            ? "Nieznana kwota"
            : "Betrag unbekannt",
      )
      const status = page.getByLabel(
        language === "en"
          ? "Lifecycle"
          : language === "pl"
            ? "Status zobowiązania"
            : "Bearbeitungsstatus",
        { exact: true },
      )
      await expect(status).toBeVisible()
      // All states remain available as translated labels, not technical enum values.
      expect(await status.locator("option").allTextContents()).not.toContain(
        "collecting_data",
      )
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true)
      await page.screenshot({
        path: info.outputPath("obligations.png"),
        fullPage: true,
      })
      expect(writes).toEqual([])
    })
  }
}

test("searches category names/codes, clears a single period selector, and restores browser history", async ({
  page,
}) => {
  const { requests, writes } = await api(page, "en", "light", false, false)
  await page.goto(
    `/ledgers/${ledgerId}?year=2026&month=10&lifecycle=unpaid&source=dashboard#invoices`,
  )
  const category = page.getByRole("combobox", { name: "Category", exact: true })
  await category.fill("electric")
  await expect(page.getByRole("option", { name: /Electricity/ })).toBeVisible()
  await expect(page.getByRole("option", { name: /Water/ })).toHaveCount(0)
  await category.press("Enter")
  await expect(page).toHaveURL(/category=ELEC/)
  await expect
    .poll(() => requests[requests.length - 1].searchParams.get("category_code"))
    .toBe("ELEC")
  await expect(category).toHaveValue("Electricity")
  const period = page.getByRole("combobox", {
    name: "Billing period",
    exact: true,
  })
  await period.selectOption("all")
  await expect
    .poll(() => requests[requests.length - 1].searchParams.has("year"))
    .toBe(false)
  await expect(page).toHaveURL(/source=dashboard/)
  expect(new URL(page.url()).hash).toBe("#invoices")
  await period.selectOption("custom")
  await page.getByLabel("Choose month", { exact: true }).fill("2022-03")
  await page.getByRole("button", { name: "Apply", exact: true }).click()
  await expect(period).toHaveValue("2022-03")
  await expect(page).toHaveURL(/year=2022/)
  await page.getByRole("button", { name: "Clear all", exact: true }).click()
  await expect(page.getByLabel("Lifecycle", { exact: true })).toHaveValue("")
  await expect(period).toHaveValue("all")
  await expect(category).toHaveValue("")
  await page.reload()
  await expect(page.getByLabel("Lifecycle", { exact: true })).toHaveValue("")
  await expect(page.getByTestId(/obligation-(row|card)/)).toHaveCount(6)
  await category.fill("watr")
  await category.press("Enter")
  await expect(category).toHaveValue("Water")
  // A real history entry exercises subscription-based back/forward restoration.
  await page.evaluate(() =>
    history.pushState(
      history.state,
      "",
      `${location.pathname}?year=2026&month=9&category=INET&lifecycle=error&source=dashboard`,
    ),
  )
  await page.reload()
  await expect(
    page.getByRole("combobox", { name: "Category", exact: true }),
  ).toHaveValue("Internet")
  await page.goBack()
  await expect(
    page.getByRole("combobox", { name: "Category", exact: true }),
  ).toHaveValue("Water")
  await page.goForward()
  await expect(
    page.getByRole("combobox", { name: "Category", exact: true }),
  ).toHaveValue("Internet")
  expect(writes).toEqual([])
})

test("viewers retain read-only access to obligation details", async ({
  page,
}) => {
  const { writes } = await api(page, "en", "light", true)
  await page.goto(`/ledgers/${ledgerId}?period=all&lifecycle=`)
  await expect(page.getByRole("button", { name: /Actions for/ })).toHaveCount(0)
  await page.getByText("Electricity", { exact: true }).click()
  await expect(
    page.getByRole("dialog", { name: "ELEC-2026-10", exact: true }),
  ).toBeVisible()
  expect(writes).toEqual([])
})

test("owner menus preserve lifecycle-specific payment and reopen actions", async ({
  page,
}) => {
  const { writes } = await api(page)
  await page.goto(`/ledgers/${ledgerId}?period=all&lifecycle=`)
  await page
    .getByRole("button", { name: "Actions for Electricity", exact: true })
    .click()
  await expect(
    page.getByRole("menuitem", { name: "Mark as paid", exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole("menuitem", { name: "Mark as ready", exact: true }),
  ).toHaveCount(0)
  await page.keyboard.press("Escape")
  await page
    .getByRole("button", { name: "Actions for Internet", exact: true })
    .click()
  await expect(
    page.getByRole("menuitem", { name: "Reopen", exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole("menuitem", { name: "Mark as paid", exact: true }),
  ).toHaveCount(0)
  expect(writes).toEqual([])
})

test("category picker reopens while focused after selection and Escape", async ({
  page,
}) => {
  const { requests } = await api(page)
  await page.goto(`/ledgers/${ledgerId}?period=all&lifecycle=`)
  const field = page.getByRole("combobox", { name: "Category", exact: true })
  await field.fill("Electric")
  await page.getByRole("option", { name: /Electricity/ }).click()
  await expect(field).toHaveValue("Electricity")
  await expect(field).toBeFocused()
  await expect(field).toHaveAttribute("aria-expanded", "false")
  await field.click()
  await expect(field).toHaveAttribute("aria-expanded", "true")
  await page.getByRole("option", { name: /Water/ }).click()
  await expect(field).toHaveValue("Water")
  await expect
    .poll(() => requests[requests.length - 1].searchParams.get("category_code"))
    .toBe("WATR")
  await field.click()
  await field.press("Escape")
  await expect(field).toHaveAttribute("aria-expanded", "false")
  await expect(field).toBeFocused()
  await field.click()
  await expect(page.getByRole("option", { name: /Electricity/ })).toBeVisible()
})
