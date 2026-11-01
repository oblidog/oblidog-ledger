import { expect, type Page, test } from "@playwright/test"

const ledgerId = "attention-home"
const obligation = {
  id: "one",
  key: "HOME-2026-10",
  category_id: "home",
  category_code: "HOME",
  category_name: "Home internet",
  ledger_id: ledgerId,
  period: { year: 2026, month: 10 },
  lifecycle: "error",
  current_amount: null,
  amount_state: "unknown",
  currency: "EUR",
  due_date: "2026-10-18",
  due_date_state: "confirmed",
  due_date_source: "manual",
  amount_source: "unknown",
  issue_date: null,
  issue_date_state: "unknown",
  issue_date_source: "unknown",
  notes: null,
  paid_at: null,
  effective_value_source: "manual",
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-18T00:00:00Z",
}
const item = {
  key: obligation.key,
  category_code: "HOME",
  name: "Home internet",
  year: 2026,
  month: 10,
  due_date: obligation.due_date,
  due_date_state: "confirmed",
  amount: null,
  amount_state: "unknown",
  currency: "EUR",
  reasons: ["overdue", "error", "incomplete"],
  integrations: [{ id: "connecta", name: "Connecta mobile", health: "error" }],
}
async function api(
  page: Page,
  language = "en",
  theme = "light",
  mode = "normal",
) {
  const requests: URL[] = []
  await page.addInitScript(
    ({ language, theme }) => {
      localStorage.setItem("oblidog-language", language)
      localStorage.setItem("vite-ui-theme", theme)
    },
    { language, theme },
  )
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname.replace(/\/$/, "")
    const send = (json: unknown) => route.fulfill({ json })
    if (path.endsWith("/utils/public-config"))
      return send({
        environment: "demo",
        is_demo: true,
        demo_writes_enabled: false,
        demo_credentials: null,
      })
    if (path.endsWith("/users/me"))
      return send({
        id: "owner",
        email: "demo@example.com",
        is_active: true,
        is_superuser: false,
        language,
      })
    const ledger = {
      id: ledgerId,
      owner_user_id: "owner",
      name: "Home",
      is_active: true,
      default_currency: "EUR",
    }
    if (path === "/api/v1/ledgers") return send({ data: [ledger], count: 1 })
    if (path === `/api/v1/ledgers/${ledgerId}`) return send(ledger)
    if (path.endsWith("/members")) return send({ data: [], count: 0 })
    if (path.endsWith("/categories"))
      return send({
        data: [
          {
            id: "home",
            name: "Home internet",
            code: "HOME",
            currency: "EUR",
            is_active: true,
          },
        ],
        count: 1,
      })
    if (path.includes("/categories/")) return send({ points: [] })
    if (path.endsWith("/attention")) {
      requests.push(url)
      if (
        mode === "error" ||
        (mode === "partial" && Number(url.searchParams.get("offset")) > 0)
      )
        return route.fulfill({ status: 503, json: { detail: "Unavailable" } })
      if (mode === "loading")
        await new Promise((resolve) => setTimeout(resolve, 1500))
      const offset = Number(url.searchParams.get("offset"))
      const items =
        mode === "empty"
          ? []
          : [
              item,
              ...Array.from({ length: 8 }, (_, i) => ({
                ...item,
                key: `EXTR-${i}`,
                name: `Extra ${i + 1}`,
                integrations: [],
                amount: "64.90",
                amount_state: "estimated",
                currency: i % 2 ? "PLN" : "EUR",
                reasons: ["overdue"],
              })),
            ]
      return send({
        as_of_date: "2026-11-01",
        items: items.slice(offset, offset + 8),
        total: items.length,
        offset,
        limit: 8,
      })
    }
    if (path.endsWith("/period-summary"))
      return send({
        period: { year: 2026, month: 11 },
        total_obligation_count: 0,
        paid_obligation_count: 0,
        paid_percentage: null,
        unknown_amount_count: 0,
        is_complete: true,
        amount_summaries: [],
      })
    if (path.endsWith("/cashflow"))
      return send({
        period: { year: 2026, month: 11 },
        as_of_date: "2026-11-01",
        unknown_amount_count: 0,
        without_due_date_count: 0,
        is_complete: true,
        currency_summaries: [],
      })
    if (path.endsWith("/period-totals")) return send({ points: [] })
    if (path.endsWith("/obligations"))
      return send({
        data: url.searchParams.has("category_code")
          ? [
              obligation,
              {
                ...obligation,
                key: "PAID-2026-10",
                category_name: "Paid bill",
                lifecycle: "paid",
              },
            ]
          : [],
        count: 0,
      })
    return send({ data: [], count: 0 })
  })
  return requests
}
for (const language of ["en", "pl", "de"])
  for (const theme of ["light", "dark"]) {
    test(`${language} ${theme}: attention, certainty, pagination and layout`, async ({
      page,
    }) => {
      const requests = await api(page, language, theme)
      await page.goto("/")
      const attention = page.locator('[aria-labelledby="attention-title"]')
      await expect(
        attention.getByText("Home internet", { exact: true }),
      ).toBeVisible()
      await expect(
        attention.getByText("Home internet", { exact: true }),
      ).toHaveCount(1)
      await expect(
        attention.getByRole("link", { name: /Connecta mobile/ }),
      ).toHaveAttribute("href", `/ledgers/${ledgerId}/integrations/connecta`)
      await expect(attention.getByRole("listitem").first()).not.toContainText(
        "0.00",
      )
      await expect(attention.getByRole("listitem")).toHaveCount(8)
      await attention.getByRole("button").click()
      await expect(attention.getByRole("listitem")).toHaveCount(9)
      expect(requests[1].searchParams.get("offset")).toBe("8")
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true)
      await page.evaluate(() => window.scrollTo(0, 0))
      await page.screenshot({
        path: `/tmp/380-${language}-${theme}-${test.info().project.name}.png`,
      })
    })
  }
test("review opens earlier unpaid period with removable filters and back navigation", async ({
  page,
}) => {
  await api(page)
  await page.goto("/")
  const review = page
    .locator('[aria-labelledby="attention-title"]')
    .getByRole("link", { name: /Review data\s*: Home internet/ })
  await expect(review).toHaveAttribute(
    "href",
    /year=2026&month=10&lifecycle=unpaid&category=HOME/,
  )
  await review.focus()
  await page.keyboard.press("Enter")
  await expect(page).toHaveURL(
    /year=2026&month=10&lifecycle=unpaid&category=HOME/,
  )
  await expect(page.getByText("Paid bill", { exact: true })).toHaveCount(0)
  await expect(
    page.getByRole("button", { name: /remove.*unpaid/i }),
  ).toBeVisible()
  await page.goBack()
  await expect(
    page.locator('[aria-labelledby="attention-title"]'),
  ).toBeVisible()
})
test("failure never claims an empty healthy ledger", async ({ page }) => {
  await api(page, "en", "light", "error")
  await page.goto("/")
  await expect(page.getByText(/Attention is unavailable/)).toBeVisible({
    timeout: 15000,
  })
  await expect(page.getByText(/No items need attention/)).toHaveCount(0)
})
test("loading, empty attention and absent next payment have distinct labels", async ({
  page,
}) => {
  await api(page, "en", "light", "loading")
  await page.goto("/")
  await expect(page.getByLabel("Loading attention items")).toBeVisible()
  await expect(
    page.getByText("No upcoming payments", { exact: true }),
  ).toBeVisible()
  await page.unrouteAll({ behavior: "wait" })
  await api(page, "en", "light", "empty")
  await page.reload()
  await expect(page.getByText(/No items need attention/)).toBeVisible()
})

test("failed later pages preserve earlier items and never claim all-clear", async ({
  page,
}) => {
  await api(page, "en", "light", "partial")
  await page.goto("/")
  const attention = page.locator('[aria-labelledby="attention-title"]')
  await expect(attention.getByRole("listitem")).toHaveCount(8)
  await attention.getByRole("button").click()
  await expect(attention.getByRole("alert")).toContainText(
    "Attention is unavailable",
    { timeout: 15000 },
  )
  await expect(attention.getByRole("listitem")).toHaveCount(8)
  await expect(attention.getByRole("button")).toBeEnabled()
})

test("a known next due date is retained when its amount is unknown", async ({
  page,
}) => {
  await api(page)
  await page.route("**/obligations?**", (route) =>
    route.fulfill({
      json: {
        data: [
          {
            ...obligation,
            due_date: "2026-11-09",
            lifecycle: "collecting_data",
            period: { year: 2026, month: 11 },
          },
        ],
        count: 1,
      },
    }),
  )
  await page.route("**/analytics/cashflow?**", (route) =>
    route.fulfill({
      json: {
        period: { year: 2026, month: 11 },
        as_of_date: "2026-11-01",
        unknown_amount_count: 1,
        without_due_date_count: 0,
        is_complete: false,
        currency_summaries: [],
      },
    }),
  )
  await page.goto("/")
  await expect(page.getByText("9 Nov 2026", { exact: true })).toBeVisible()
  await expect(
    page.getByText("No upcoming payments", { exact: true }),
  ).toHaveCount(0)
})

test("one currency with a known outstanding amount does not show an empty-state message", async ({
  page,
}) => {
  await api(page)
  await page.route("**/analytics/cashflow?**", (route) =>
    route.fulfill({
      json: {
        period: { year: 2026, month: 11 },
        as_of_date: "2026-11-01",
        unknown_amount_count: 0,
        without_due_date_count: 0,
        is_complete: true,
        currency_summaries: [
          {
            currency: "EUR",
            total_known_amount: "1189.02",
            scheduled_known_amount: "1189.02",
            unscheduled_known_amount: "0.00",
            overdue_known_amount: "0.00",
            daily: [
              {
                due_date: "2026-11-09",
                amount: "1189.02",
                cumulative_amount: "1189.02",
                is_overdue: false,
              },
            ],
          },
        ],
      },
    }),
  )
  await page.goto("/")
  const card = page
    .locator('[data-slot="card"]')
    .filter({ has: page.getByText("Remaining to pay", { exact: true }) })
  await expect(card.getByText("1,189.02 EUR", { exact: true })).toBeVisible()
  await expect(
    card.getByText("No known unpaid amounts", { exact: true }),
  ).toHaveCount(0)
})
