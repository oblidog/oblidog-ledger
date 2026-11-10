import { expect, type Page, test } from "@playwright/test"
import type {
  ObligationActionPublic,
  ObligationComponentPublic,
  ObligationPublic,
} from "../src/client"

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
  detailOverride: Partial<ObligationPublic> = {},
  extraRows: ObligationPublic[] = [],
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
        language,
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
      const selectedPeriods = url.searchParams.getAll("periods")
      const year = url.searchParams.get("year")
      const month = url.searchParams.get("month")
      const data = [...rows, ...extraRows].filter(
        (row) =>
          (selectedPeriods.length === 0 ||
            selectedPeriods.includes(
              `${row.period.year}-${String(row.period.month).padStart(2, "0")}`,
            )) &&
          (!year || row.period.year === Number(year)) &&
          (!month || row.period.month === Number(month)) &&
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
    if (row) return send({ ...row, ...detailOverride })
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
  await expect(
    page.getByRole("button", { name: "Remove filter: Period: March 2022" }),
  ).toBeVisible()
  await expect(page).toHaveURL(/year=2022/)
  await page.getByRole("button", { name: "Clear all", exact: true }).click()
  await expect(page.getByLabel("Lifecycle", { exact: true })).toHaveValue("")
  await expect(period.locator("option:checked")).toHaveText("All periods")
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

test("combines non-consecutive months and restores the selection on reload and navigation", async ({
  page,
}) => {
  const oldBill = {
    ...obligation("March electricity", "ELEC", "ready", "39.90"),
    id: "electricity-2022-03",
    key: "ELEC-2022-03",
    period: { year: 2022, month: 3 },
    due_date: "2022-03-15",
  }
  const { requests } = await api(page, "en", "light", false, false, {}, [
    oldBill,
    {
      ...oldBill,
      id: "electricity-2022-04",
      key: "ELEC-2022-04",
      period: { year: 2022, month: 4 },
    },
  ])
  await page.setViewportSize({ width: 375, height: 800 })
  await page.goto(
    `/ledgers/${ledgerId}?year=2026&month=10&category=ELEC&lifecycle=ready`,
  )
  const items = page.getByTestId("obligation-card")
  const october = page.getByRole("button", {
    name: "Remove filter: Period: October 2026",
  })
  const march = page.getByRole("button", {
    name: "Remove filter: Period: March 2022",
  })

  await expect(items).toHaveCount(1)
  await page
    .getByLabel("Billing period", { exact: true })
    .selectOption("custom")
  await page.getByLabel("Choose month", { exact: true }).fill("2022-03")
  await page.getByRole("button", { name: "Apply", exact: true }).press("Enter")
  await expect(items).toHaveCount(2)
  await expect(items.first()).toContainText("March electricity")
  await expect(october).toBeVisible()
  await expect(march).toBeVisible()
  const query = requests[requests.length - 1]?.searchParams
  expect(query?.getAll("periods")).toEqual(["2022-03", "2026-10"])
  expect(query?.get("category_code")).toBe("ELEC")
  expect(query?.get("lifecycle")).toBe("ready")
  expect(query?.has("year")).toBe(false)
  expect(query?.has("month")).toBe(false)

  await page.reload()
  await expect(items).toHaveCount(2)
  await page.goBack()
  await expect(items).toHaveCount(1)
  await expect(march).toHaveCount(0)
  await page.goForward()
  await expect(items).toHaveCount(2)

  await march.press("Enter")
  await expect(items).toHaveCount(1)
  await october.press("Enter")
  await expect(page).toHaveURL(/period=all/)
  await expect(items).toHaveCount(3)
  const url = new URL(page.url())
  expect(url.searchParams.get("category")).toBe("ELEC")
  expect(url.searchParams.get("lifecycle")).toBe("ready")
})

test("viewers retain read-only access to obligation details", async ({
  page,
}) => {
  const { writes } = await api(page, "en", "light", true)
  await page.goto(`/ledgers/${ledgerId}?period=all&lifecycle=`)
  await expect(page.getByRole("button", { name: /Actions for/ })).toHaveCount(0)
  await expect(
    page.getByRole("button", { name: "Mark as paid", exact: true }),
  ).toHaveCount(0)
  await page.getByText("Electricity", { exact: true }).click()
  await expect(
    page.getByRole("dialog", { name: "Electricity", exact: true }),
  ).toBeVisible()
  expect(writes).toEqual([])
})

test("owners can open payment from the list and reopen from the menu", async ({
  page,
}, testInfo) => {
  const { writes } = await api(page)
  await page.goto(`/ledgers/${ledgerId}?period=all&lifecycle=`)
  const electricity = page
    .getByTestId(/obligation-(row|card)/)
    .filter({ hasText: "ELEC-2026-10" })
  const paymentAction = electricity.getByRole("button", {
    name: "Mark as paid",
    exact: true,
  })
  await paymentAction.press("Enter")
  const confirmation = page.getByRole("dialog", {
    name: "Mark obligation as paid?",
  })
  await expect(confirmation).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(confirmation).toBeHidden()
  await expect(paymentAction).toBeFocused()

  await paymentAction.press("Enter")
  await expect(confirmation).toBeVisible()
  await confirmation
    .getByRole("button", { name: "Cancel", exact: true })
    .click()
  await expect(confirmation).toBeHidden()
  await expect(paymentAction).toBeFocused()
  await electricity
    .getByRole("button", { name: "Actions for Electricity", exact: true })
    .click()
  await expect(
    page.getByRole("menuitem", { name: "Mark as paid", exact: true }),
  ).toHaveCount(testInfo.project.name === "mobile" ? 1 : 0)
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

test("desktop table keeps compact actions visible without horizontal scrolling", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop")
  await api(page, "pl")
  await page.setViewportSize({ width: 1000, height: 800 })
  await page.goto(`/ledgers/${ledgerId}?period=all&lifecycle=`)
  const payment = page.getByRole("button", {
    name: "Oznacz jako opłacone",
    exact: true,
  })
  const menu = page.getByRole("button", {
    name: "Akcje dla Electricity",
    exact: true,
  })
  await expect(payment).toBeInViewport({ ratio: 1 })
  await expect(menu).toBeInViewport({ ratio: 1 })
  await expect(payment.getByText("Oznacz jako opłacone")).toHaveCSS(
    "position",
    "absolute",
  )
  await payment.focus()
  await expect(page.getByRole("tooltip")).toHaveText("Oznacz jako opłacone")

  await page.setViewportSize({ width: 1600, height: 800 })
  await expect(payment.getByText("Oznacz jako opłacone")).toHaveCSS(
    "position",
    "static",
  )
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

test("active badges clear individual filters and preserve navigation context", async ({
  page,
}) => {
  const { requests, writes } = await api(page, "en", "light", false, false)
  await page.goto(
    `/ledgers/${ledgerId}?year=2026&month=10&category=ELEC&lifecycle=unpaid&source=dashboard#invoices`,
  )
  const badges = page.getByRole("group", {
    name: "Active filters",
    exact: true,
  })
  await expect(
    badges.getByText("Category: Electricity", { exact: true }),
  ).toBeVisible()
  await expect(
    badges.getByText("Status: Unpaid", { exact: true }),
  ).toBeVisible()
  await expect(
    badges.getByText("Period: October 2026", { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Clear all", exact: true }),
  ).toHaveCount(1)
  await badges
    .getByRole("button", {
      name: "Remove filter: Category: Electricity",
      exact: true,
    })
    .click()
  await expect(
    page.getByRole("combobox", { name: "Category", exact: true }),
  ).toHaveValue("")
  await expect(
    badges.getByText("Status: Unpaid", { exact: true }),
  ).toBeVisible()
  await expect(
    badges.getByRole("button", { name: "Remove filter: Period: October 2026" }),
  ).toBeVisible()
  await expect
    .poll(() => requests[requests.length - 1].searchParams.has("category_code"))
    .toBe(false)
  await badges
    .getByRole("button", {
      name: "Remove filter: Period: October 2026",
      exact: true,
    })
    .click()
  await expect(
    badges.getByText("Status: Unpaid", { exact: true }),
  ).toBeVisible()
  await expect(
    page
      .getByRole("combobox", { name: "Billing period", exact: true })
      .locator("option:checked"),
  ).toHaveText("All periods")
  await expect
    .poll(() => requests[requests.length - 1].searchParams.has("year"))
    .toBe(false)
  await badges
    .getByRole("button", { name: "Remove filter: Status: Unpaid", exact: true })
    .click()
  await expect(badges).toHaveCount(0)
  await expect(page.getByLabel("Lifecycle", { exact: true })).toHaveValue("")
  const url = new URL(page.url())
  expect(url.searchParams.get("period")).toBe("all")
  expect(url.searchParams.get("source")).toBe("dashboard")
  expect(url.hash).toBe("#invoices")
  await expect(page.getByRole("checkbox")).toHaveCount(0)
  await page.reload()
  await expect(page.getByLabel("Lifecycle", { exact: true })).toHaveValue("")
  await expect(
    page.getByRole("group", { name: "Active filters", exact: true }),
  ).toHaveCount(0)
  expect(writes).toEqual([])
})

test("one clear-all action resets restored badges and the period selector", async ({
  page,
}) => {
  const { requests } = await api(page)
  await page.goto(
    `/ledgers/${ledgerId}?year=2026&month=10&category=ELEC&lifecycle=ready`,
  )
  await expect(
    page.getByRole("group", { name: "Active filters", exact: true }),
  ).toBeVisible()
  await page.getByRole("button", { name: "Clear all", exact: true }).click()
  await expect(
    page.getByRole("group", { name: "Active filters", exact: true }),
  ).toHaveCount(0)
  await expect(
    page
      .getByRole("combobox", { name: "Billing period", exact: true })
      .locator("option:checked"),
  ).toHaveText("All periods")
  await expect(
    page.getByRole("combobox", { name: "Category", exact: true }),
  ).toHaveValue("")
  await expect
    .poll(() => requests[requests.length - 1].searchParams.has("year"))
    .toBe(false)
  await expect(
    page.getByRole("button", { name: "Clear all", exact: true }),
  ).toBeDisabled()
})

test("category badge falls back to its stored code when names are unavailable", async ({
  page,
}) => {
  await api(page)
  await page.route("**/categories?**", (route) =>
    route.fulfill({ json: { data: [], count: 0 } }),
  )
  await page.goto(`/ledgers/${ledgerId}?period=all&category=ELEC&lifecycle=`)
  const badges = page.getByRole("group", {
    name: "Active filters",
    exact: true,
  })
  await expect(
    badges.getByText("Category: ELEC", { exact: true }),
  ).toBeVisible()
  await badges
    .getByRole("button", { name: "Remove filter: Category: ELEC", exact: true })
    .click()
  await expect(badges).toHaveCount(0)
})

for (const language of ["en", "pl", "de"] as const) {
  for (const theme of ["light", "dark"]) {
    test(`${language} ${theme}: payment details and keyboard-accessible provenance`, async ({
      page,
    }, info) => {
      const labels = {
        en: [
          "Payment summary",
          "Data origin",
          "Overridden",
          "Estimated",
          "Unknown",
          "Activity",
          "Components",
        ],
        pl: [
          "Podsumowanie płatności",
          "Pochodzenie danych",
          "Nadpisane ręcznie",
          "Szacowane",
          "Nieznane",
          "Aktywność",
          "Składniki",
        ],
        de: [
          "Zahlungsübersicht",
          "Datenherkunft",
          "Überschrieben",
          "Geschätzt",
          "Unbekannt",
          "Aktivität",
          "Posten",
        ],
      }[language]
      const title = `Electricity ${"longcategory".repeat(8)}`
      const { writes } = await api(page, language, theme, true, true, {
        name: title,
        amount_state: "overridden",
        amount_source: "manual",
        issue_date: null,
        issue_date_state: "unknown",
        due_date_state: "estimated",
        due_date_source: "integration",
        effective_value_source: "mixed",
        counterparty: {
          id: "provider",
          name: "Provider".repeat(30),
          short_name: null,
          logo_url: null,
        },
      })
      await page.goto(`/ledgers/${ledgerId}?period=all&lifecycle=`)
      await page.getByText("Electricity", { exact: true }).click()
      const dialog = page.getByRole("dialog", { name: title, exact: true })
      await expect(dialog).toBeVisible()
      const summary = dialog.getByRole("region", { name: labels[0] })
      await expect(summary).toContainText("208")
      await expect(summary).toContainText("EUR")
      await expect(summary.getByText(labels[2], { exact: true })).toBeVisible()
      await expect(summary.getByText(labels[3], { exact: true })).toBeVisible()
      await expect(summary.getByText(labels[4], { exact: true })).toBeVisible()
      await expect(
        summary.getByText("ELEC-2026-10", { exact: true }),
      ).toBeVisible()
      await expect(dialog.locator("table")).toBeHidden()
      const origin = dialog.locator("summary", { hasText: labels[1] })
      await origin.focus()
      await page.keyboard.press("Enter")
      await expect(dialog.locator("table")).toBeVisible()
      await expect(dialog.locator("table")).toContainText(labels[2])
      await expect(dialog.locator("table")).toContainText(labels[3])
      expect(
        await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true)
      expect(
        await summary.evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true)
      await page.screenshot({ path: info.outputPath("payment-details.png") })
      await page.keyboard.press("Space")
      await expect(dialog.locator("table")).toBeHidden()
      await dialog.getByRole("tab", { name: labels[5], exact: true }).click()
      await dialog.getByRole("tab", { name: labels[6], exact: true }).click()
      await page.keyboard.press("Escape")
      await expect(dialog).toBeHidden()
      expect(writes).toEqual([])
    })
  }
}

test("unknown amount and paid date remain explicit without a confirmed summary", async ({
  page,
}) => {
  await api(page, "en", "light", true, true, {
    current_amount: null,
    amount_state: "unknown",
    lifecycle: "paid",
    paid_at: null,
  })
  await page.goto(`/ledgers/${ledgerId}?period=all&lifecycle=`)
  await page.getByText("Electricity", { exact: true }).click()
  const summary = page.getByRole("region", { name: "Payment summary" })
  await expect(
    summary.getByText("Amount unknown", { exact: true }),
  ).toBeVisible()
  await expect(
    summary.getByText("Date unavailable", { exact: true }),
  ).toBeVisible()
  await expect(summary.getByText("Confirmed", { exact: true })).toHaveCount(0)
  await expect(summary.getByText("Overdue", { exact: true })).toHaveCount(0)
})

for (const height of [480, 568]) {
  test(`maximum category name keeps details and actions usable at 320x${height}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: 320, height })
    const title = "A".repeat(255)
    const { writes } = await api(page, "pl", "dark", false, false, {
      name: title,
    })
    await page.goto(`/ledgers/${ledgerId}?period=all&lifecycle=`)
    await page.getByText("Electricity", { exact: true }).click()
    const dialog = page.getByRole("dialog", { name: title, exact: true })
    const header = dialog.locator('[data-slot="dialog-header"]')
    await expect(dialog).toBeVisible()
    await header.focus()
    await page.keyboard.press("End")
    await expect
      .poll(() => header.evaluate((el) => el.scrollTop))
      .toBeGreaterThan(0)
    await expect(
      header.getByText("październik 2026", { exact: true }),
    ).toBeInViewport()
    const panel = dialog.getByRole("tabpanel")
    const tabs = dialog.getByRole("tablist")
    const footer = dialog.locator('[data-slot="dialog-footer"]')
    const bounds = await Promise.all(
      [dialog, tabs, panel, footer].map((locator) => locator.boundingBox()),
    )
    const [modalBox, tabsBox, panelBox, footerBox] = bounds.map((box) => box!)
    expect(panelBox.height).toBeGreaterThanOrEqual(80)
    expect(panelBox.y).toBeGreaterThanOrEqual(tabsBox.y + tabsBox.height - 1)
    expect(footerBox.y).toBeGreaterThanOrEqual(panelBox.y + panelBox.height - 1)
    expect(footerBox.y + footerBox.height).toBeLessThanOrEqual(
      modalBox.y + modalBox.height + 1,
    )
    expect(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true)
    await expect(
      dialog.getByRole("region", { name: "Podsumowanie płatności" }),
    ).toBeInViewport()
    await page.screenshot({
      path: info.outputPath("long-title-short-screen.png"),
    })
    await dialog
      .getByRole("button", { name: "Oznacz jako opłacone", exact: true })
      .click()
    await expect(
      page.getByRole("dialog", {
        name: "Oznaczyć zobowiązanie jako opłacone?",
      }),
    ).toBeVisible()
    expect(writes).toEqual([])
  })
}

for (const theme of ["light", "dark"]) {
  test(`demo language switching preserves selected filters and data in ${theme} mode`, async ({
    page,
  }, info) => {
    const { requests, writes } = await api(page, "en", theme, false, true, {
      effective_value_source: "integration",
      notes: "October invoice",
    })
    const component: ObligationComponentPublic = {
      id: "energy",
      obligation_id: "ELEC",
      type: "INVOICE_LINE",
      label: "Energy",
      amount: "1234.56",
      source: "integration",
      external_id: "energy-10",
      metadata: null,
      created_at: "2026-10-01T12:00:00Z",
      updated_at: "2026-10-01T12:00:00Z",
    }
    const custom = {
      ...component,
      id: "meter",
      type: "Custom_Meter",
      label: "Meter rental",
      external_id: "meter-10",
    }
    const action: ObligationActionPublic = {
      id: "updated-energy",
      obligation_id: "ELEC",
      action: "components_changed",
      actor_type: "integration",
      actor_id: "northgrid",
      actor_display_name: "NorthGrid billing",
      integration_id: "northgrid",
      run_id: null,
      changes: {
        components: {
          updated: [
            {
              id: component.id,
              label: component.label,
              changes: { type: { from: "Custom_Meter", to: "INVOICE_LINE" } },
            },
          ],
        },
      },
      metadata: null,
      created_at: component.created_at,
    }
    await page.route(
      (url) => url.pathname.endsWith("/obligations/ELEC-2026-10/components"),
      (route) =>
        route.fulfill({ json: { data: [component, custom], count: 2 } }),
    )
    await page.route(
      (url) => url.pathname.endsWith("/obligations/ELEC-2026-10/actions"),
      (route) => route.fulfill({ json: { data: [action], count: 1 } }),
    )
    await page.goto(
      `/ledgers/${ledgerId}?year=2026&month=10&category=ELEC&lifecycle=ready`,
    )
    const selectedUrl = page.url()
    const strings = [
      {
        language: "en",
        period: "October 2026",
        ready: "Ready",
        origin: "Data origin",
        components: "Components",
        activity: "Activity",
        invoice: "Invoice line",
        integration: "Integration",
        amount: "1,234.56 EUR",
      },
      {
        language: "pl",
        period: "październik 2026",
        ready: "Gotowe do opłacenia",
        origin: "Pochodzenie danych",
        components: "Składniki",
        activity: "Aktywność",
        invoice: "Pozycja faktury",
        integration: "Integracja",
        amount: "1234,56 EUR",
      },
      {
        language: "de",
        period: "Oktober 2026",
        ready: "Bereit",
        origin: "Datenherkunft",
        components: "Posten",
        activity: "Aktivität",
        invoice: "Rechnungsposition",
        integration: "Integration",
        amount: "1.234,56 EUR",
      },
    ]

    for (const labels of strings) {
      if (labels.language !== "en") {
        if (info.project.name === "mobile") {
          await page
            .getByRole("button", { name: /^(More|Więcej)$/ })
            .first()
            .click()
        }
        await page
          .getByTestId("language-selector")
          .filter({ visible: true })
          .selectOption(labels.language)
        if (info.project.name === "mobile") {
          await page.locator('[data-slot="sheet-overlay"]').tap({
            position: { x: page.viewportSize()!.width - 12, y: 12 },
          })
          await expect(page.getByRole("dialog")).toBeHidden()
        }
      }
      await expect(page.locator("html")).toHaveAttribute(
        "lang",
        labels.language,
      )
      await expect(page.locator("html")).toHaveClass(new RegExp(theme))
      await expect(page).toHaveURL(selectedUrl)
      await expect(page.locator('option[value="2026-10"]')).toHaveText(
        `✓ ${labels.period}`,
      )
      await expect(page.locator('option[value="ready"]')).toHaveText(
        labels.ready,
      )

      const item = page.getByTestId(/obligation-(row|card)/)
      await expect(item).toHaveCount(1)
      await item.getByText("Electricity", { exact: true }).click()
      const dialog = page.getByRole("dialog", { name: "Electricity" })
      await expect(
        dialog.getByText(labels.period, { exact: true }),
      ).toBeVisible()
      await expect(
        dialog.getByText("October invoice", { exact: true }),
      ).toBeVisible()
      const origin = dialog.locator("summary", { hasText: labels.origin })
      await origin.press("Enter")
      await expect(
        origin.locator("..").getByText(labels.integration, { exact: true }),
      ).toBeVisible()

      await dialog
        .getByRole("tab", { name: labels.components, exact: true })
        .click()
      const energy = dialog.getByRole("row").filter({ hasText: /^Energy/ })
      await expect(
        energy.getByText(labels.invoice, { exact: true }),
      ).toBeVisible()
      await expect(
        energy.getByText("integration", { exact: true }),
      ).toBeVisible()
      await expect(energy.getByText("energy-10", { exact: true })).toBeVisible()
      await expect(
        energy.getByText(labels.amount, { exact: true }),
      ).toBeVisible()
      await expect(
        dialog.getByText("Custom_Meter", { exact: true }),
      ).toBeVisible()

      await dialog
        .getByRole("tab", { name: labels.activity, exact: true })
        .click()
      await expect(
        dialog.getByText(labels.invoice, { exact: true }),
      ).toBeVisible()
      await expect(
        dialog.getByText(`${labels.integration} · NorthGrid billing`, {
          exact: true,
        }),
      ).toBeVisible()
      await page.keyboard.press("Escape")
      await expect(dialog).toBeHidden()
    }

    expect(requests.length).toBeGreaterThan(0)
    for (const request of requests) {
      expect(request.searchParams.get("year")).toBe("2026")
      expect(request.searchParams.get("month")).toBe("10")
      expect(request.searchParams.get("category_code")).toBe("ELEC")
      expect(request.searchParams.get("lifecycle")).toBe("ready")
    }
    expect(writes).toEqual([])
  })
}
