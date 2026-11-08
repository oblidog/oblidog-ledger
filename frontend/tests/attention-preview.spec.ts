import { expect, type Page, test } from "@playwright/test"

const ledgerId = "attention-home"
const otherLedgerId = "attention-other"
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
const calendarRows = [
  {
    ...obligation,
    name: "October internet",
    due_date: "2026-11-02",
    lifecycle: "ready",
    current_amount: "45.00",
    amount_state: "confirmed",
  },
  {
    ...obligation,
    id: "paid",
    key: "WATR-2026-11",
    name: "Paid water",
    due_date: "2026-11-02",
    lifecycle: "paid",
    period: { year: 2026, month: 11 },
  },
  {
    ...obligation,
    id: "canceled",
    key: "AUTO-2026-10",
    name: "Canceled insurance",
    due_date: "2026-11-02",
    lifecycle: "canceled",
  },
  {
    ...obligation,
    id: "incomplete",
    key: "GASS-2026-11",
    name: "Gas bill",
    due_date: "2026-11-02",
    period: { year: 2026, month: 11 },
  },
  {
    ...obligation,
    id: "undated",
    key: "RENT-2026-11",
    name: "Undated rent",
    due_date: null,
    lifecycle: "draft",
    period: { year: 2026, month: 11 },
  },
]
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
  calendarDate: () => string | Promise<string> = () => "2026-11-03",
) {
  const requests: URL[] = []
  const calendarRequests: URL[] = []
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
    const otherLedger = { ...ledger, id: otherLedgerId, name: "Second ledger" }
    if (path === "/api/v1/ledgers") {
      const data = mode === "calendar" ? [ledger, otherLedger] : [ledger]
      return send({ data, count: data.length })
    }
    if (path === `/api/v1/ledgers/${ledgerId}`) return send(ledger)
    if (path === `/api/v1/ledgers/${otherLedgerId}`) return send(otherLedger)
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
        as_of_date: mode === "calendar" ? await calendarDate() : "2026-11-01",
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
    if (mode === "calendar" && path.endsWith("/obligations")) {
      const from = url.searchParams.get("due_from")
      const to = url.searchParams.get("due_to")
      if (from || to) calendarRequests.push(url)
      if (path === `/api/v1/ledgers/${otherLedgerId}/obligations`)
        return send({ data: [], count: 0 })
      const data = calendarRows.filter((row) =>
        from && to
          ? row.due_date && row.due_date >= from && row.due_date <= to
          : row.period.year === Number(url.searchParams.get("year")) &&
            row.period.month === Number(url.searchParams.get("month")),
      )
      return send({ data, count: data.length })
    }
    if (mode === "calendar" && path.endsWith(`/obligations/${obligation.key}`))
      return send(calendarRows[0])
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
  return mode === "calendar" ? calendarRequests : requests
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

for (const [language, month, next, previous, todayLabel] of [
  ["en", "November 2026", "Next month", "Previous month", "Today"],
  ["pl", "listopad 2026", "Następny miesiąc", "Poprzedni miesiąc", "Dzisiaj"],
  ["de", "November 2026", "Nächster Monat", "Vorheriger Monat", "Heute"],
]) {
  test(`${language}: due calendar dates, keyboard navigation and details in demo`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 780 })
    await page.clock.setFixedTime(new Date("2026-10-31T20:00:00Z"))
    const requests = await api(page, language, "light", "calendar")
    await page.goto("/")
    const calendar = page.locator('[aria-labelledby="due-calendar-title"]')
    const grid = calendar.getByRole("group")
    const today = grid.locator('button[aria-current="date"]')
    await expect(today).toHaveText("3")
    await expect(today).toHaveAttribute("aria-pressed", "true")
    await expect(calendar.getByText(month, { exact: true })).toBeVisible()
    expect(
      requests.some(
        ({ searchParams }) =>
          searchParams.get("due_from") === "2026-11-01" &&
          searchParams.get("due_to") === "2026-11-30" &&
          !searchParams.has("month"),
      ),
    ).toBe(true)
    await expect(
      calendar.getByRole("link", { name: "Undated rent" }),
    ).toBeVisible()

    const day = grid.getByRole("button").filter({ hasText: /^2$/ })
    await day.focus()
    await page.keyboard.press("Space")
    await expect(day).toHaveAttribute("aria-pressed", "true")
    await expect(day).toHaveAccessibleName(/2.*(?:Overdue|Zaległe|Überfällig)/)
    await expect(
      calendar.getByRole("link", { name: "October internet" }),
    ).toBeVisible()
    await expect(
      calendar.getByRole("link", { name: "Paid water" }),
    ).toBeVisible()
    await expect(calendar.getByText("Canceled insurance")).toHaveCount(0)
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(360)

    await calendar.getByRole("button", { name: next }).focus()
    await page.keyboard.press("Enter")
    await expect(grid.getByRole("button")).toHaveCount(31)
    await expect(calendar.getByText(month, { exact: true })).toHaveCount(0)
    await calendar.getByRole("button", { name: previous }).click()
    await expect(calendar.getByText(month, { exact: true })).toBeVisible()
    await calendar
      .getByRole("button", { name: todayLabel, exact: true })
      .click()
    await expect(today).toHaveAttribute("aria-pressed", "true")

    if (language === "en") {
      await day.click()
      await expect(
        calendar.getByRole("listitem").filter({ hasText: "Gas bill" }),
      ).toContainText("Overdue · Needs review")
      await calendar.getByRole("link", { name: "October internet" }).click()
      await expect(page).toHaveURL(
        /year=2026&month=10.*obligation=HOME-2026-10/,
      )
      const dialog = page.getByRole("dialog")
      await expect(dialog).toContainText("October internet")
      await page.keyboard.press("Escape")
      await expect(dialog).toHaveCount(0)
      await expect(page).toHaveURL((url) => {
        const params = url.searchParams
        return (
          params.get("year") === "2026" &&
          params.get("month") === "10" &&
          params.get("lifecycle") === "" &&
          !params.has("obligation")
        )
      })
      await page.reload()
      await expect(
        page.getByText("October internet", { exact: true }),
      ).toBeVisible()
      await expect(dialog).toHaveCount(0)
    }
  })
}

test("due calendar resets its selection and requests when switching ledgers", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 780 })
  const requests = await api(page, "en", "light", "calendar")
  await page.goto("/")
  const calendar = page.locator('[aria-labelledby="due-calendar-title"]')
  await expect(
    calendar.getByRole("link", { name: "Undated rent" }),
  ).toBeVisible()
  await calendar.getByRole("button", { name: "Next month" }).click()
  await expect(
    calendar.getByText("December 2026", { exact: true }),
  ).toBeVisible()
  await page.getByTestId("ledger-switcher").click()
  await page.getByRole("menuitem", { name: "Second ledger" }).click()
  await expect(page).toHaveURL(`/ledgers/${otherLedgerId}`)
  await page.getByRole("link", { name: "Dashboard", exact: true }).click()
  await expect(
    calendar.getByText("November 2026", { exact: true }),
  ).toBeVisible()
  await expect(
    calendar.getByRole("group").locator('[aria-current="date"]'),
  ).toHaveText("3")
  await expect(
    calendar.getByRole("link", { name: "Undated rent" }),
  ).toHaveCount(0)
  expect(
    requests.some(
      (request) =>
        request.pathname.endsWith(`/${otherLedgerId}/obligations`) &&
        request.searchParams.get("due_from") === "2026-11-01",
    ),
  ).toBe(true)
})

test.describe("due calendar with a different business date", () => {
  test.use({ timezoneId: "UTC" })

  test("keeps the chosen month when the initial business date arrives", async ({
    page,
  }) => {
    const businessDate = Promise.withResolvers<string>()
    await page.clock.setFixedTime(new Date("2026-10-31T23:30:00Z"))
    await api(page, "en", "light", "calendar", () => businessDate.promise)
    await page.goto("/")
    const calendar = page.locator('[aria-labelledby="due-calendar-title"]')
    await expect(
      calendar.getByText("October 2026", { exact: true }),
    ).toBeVisible()
    await calendar.getByRole("button", { name: "Next month" }).click()
    await expect(
      calendar.getByText("November 2026", { exact: true }),
    ).toBeVisible()

    businessDate.resolve("2026-11-01")
    await expect(calendar.locator('[aria-current="date"]')).toHaveText("1")
    await expect(
      calendar.getByText("November 2026", { exact: true }),
    ).toBeVisible()
  })

  test("Today refreshes the business date and overdue statuses after midnight", async ({
    page,
  }) => {
    let businessDate = "2026-11-02"
    await page.clock.setFixedTime(new Date("2026-11-02T22:30:00Z"))
    await api(page, "en", "light", "calendar", () => businessDate)
    await page.goto("/")
    const calendar = page.locator('[aria-labelledby="due-calendar-title"]')
    const today = calendar.locator('[aria-current="date"]')
    await expect(today).toHaveText("2")
    const bill = calendar
      .getByRole("listitem")
      .filter({ hasText: "October internet" })
    await expect(bill).toContainText("Due")

    businessDate = "2026-11-03"
    await page.clock.setFixedTime(new Date("2026-11-02T23:30:00Z"))
    await calendar.getByRole("button", { name: "Today", exact: true }).click()
    await expect(today).toHaveText("3")
    await expect(today).toHaveAttribute("aria-pressed", "true")
    await calendar
      .getByRole("group")
      .getByRole("button")
      .filter({ hasText: /^2$/ })
      .click()
    await expect(bill).toContainText("Overdue")
  })
})

for (const [language, forecastTitle, calendarTitle, periodLabel] of [
  ["en", "Payment Forecast", "Due Calendar", "Reporting period"],
  ["pl", "Prognoza płatności", "Kalendarz płatności", "Okres rozliczeniowy"],
  ["de", "Zahlungsprognose", "Fälligkeitskalender", "Abrechnungszeitraum"],
]) {
  test(`${language}: dashboard payment widgets keep amounts and fit desktop and mobile`, async ({
    page,
  }) => {
    await page.clock.setFixedTime(new Date("2026-11-03T12:00:00Z"))
    await page.setViewportSize({ width: 1440, height: 1000 })
    await api(page, language, "light", "calendar")
    await page.route("**/analytics/cashflow?**", (route) => {
      const month = Number(
        new URL(route.request().url()).searchParams.get("month"),
      )
      return route.fulfill({
        json: {
          period: { year: 2026, month },
          as_of_date: "2026-11-03",
          unknown_amount_count: 0,
          without_due_date_count: 0,
          is_complete: true,
          currency_summaries: [
            { currency: "EUR", amount: month === 11 ? "45.00" : "32.00" },
            { currency: "USD", amount: "17.50" },
          ].map(({ currency, amount }) => ({
            currency,
            total_known_amount: amount,
            scheduled_known_amount: amount,
            unscheduled_known_amount: "0.00",
            overdue_known_amount: "0.00",
            daily: [
              {
                due_date: `2026-${month}-09`,
                amount,
                cumulative_amount: amount,
                is_overdue: false,
              },
            ],
          })),
        },
      })
    })
    await page.goto("/")
    const widgets = page.getByTestId("dashboard-payment-widgets")
    const calendar = widgets.getByRole("region", { name: calendarTitle })
    const forecast = widgets.getByRole("region", { name: forecastTitle })
    const period = forecast.getByRole("combobox", { name: periodLabel })
    const charts = forecast.getByTestId("payment-schedule-chart")
    await expect(
      calendar.getByRole("group").locator('[aria-current="date"]'),
    ).toHaveText("3")
    await expect(period).toBeVisible()
    await expect(charts).toHaveCount(2)
    for (const chart of await charts.all()) {
      await expect(chart.locator(".recharts-bar-rectangle path")).toBeVisible()
    }
    await expect(forecast.locator("strong")).toHaveText(
      language === "en"
        ? ["45.00 EUR", "17.50 USD"]
        : ["45,00 EUR", "17,50 USD"],
    )
    const desktopCalendar = (await calendar.boundingBox())!
    const desktopForecast = (await forecast.boundingBox())!
    expect(desktopCalendar.y).toBeCloseTo(desktopForecast.y, 0)
    expect(desktopForecast.x).toBeGreaterThan(
      desktopCalendar.x + desktopCalendar.width,
    )

    await page.setViewportSize({ width: 390, height: 844 })
    const mobileCalendar = (await calendar.boundingBox())!
    const mobileForecast = (await forecast.boundingBox())!
    expect(mobileForecast.x).toBeCloseTo(mobileCalendar.x, 0)
    expect(mobileForecast.y).toBeGreaterThan(
      mobileCalendar.y + mobileCalendar.height,
    )
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      )
      .toBe(true)

    if (language === "en") {
      await period.click()
      await page.getByRole("option", { name: "October 2026" }).click()
      await expect(forecast.locator("strong").first()).toHaveText("32.00 EUR")
      await expect(
        calendar.getByText("November 2026", { exact: true }),
      ).toBeVisible()
    }
  })
}

test("dashboard payment widgets announce loading, empty results and errors", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-11-03T12:00:00Z"))
  await api(page, "en", "light", "calendar")
  const releaseLoading = Promise.withResolvers<void>()
  await page.route("**/analytics/cashflow?**", async (route) => {
    const month = new URL(route.request().url()).searchParams.get("month")
    if (month === "10")
      return route.fulfill({ status: 400, json: { detail: "Unavailable" } })
    await releaseLoading.promise
    return route.fallback()
  })
  await page.route("**/obligations?**", async (route) => {
    const from = new URL(route.request().url()).searchParams.get("due_from")
    if (from === "2026-12-01")
      return route.fulfill({ status: 400, json: { detail: "Unavailable" } })
    if (from) await releaseLoading.promise
    return route.fallback()
  })
  await page.goto("/")
  const widgets = page.getByTestId("dashboard-payment-widgets")
  const calendar = widgets.getByRole("region", { name: "Due Calendar" })
  const forecast = widgets.getByRole("region", { name: "Payment Forecast" })
  await expect(calendar.getByRole("status")).toHaveText("Loading due calendar")
  await expect(forecast.getByRole("status")).toHaveText(
    "Loading payment forecast",
  )
  releaseLoading.resolve()
  await expect(calendar.getByRole("status")).toHaveText(
    "No payments on this day",
  )
  await expect(forecast.getByRole("status")).toHaveText(
    "No unpaid known amounts.",
  )

  await calendar.getByRole("button", { name: "Next month" }).click()
  await expect(calendar.getByRole("alert")).toHaveText(
    "Calendar could not be loaded",
    { timeout: 15_000 },
  )
  await forecast.getByRole("combobox", { name: "Reporting period" }).click()
  await page.getByRole("option", { name: "October 2026" }).click()
  await expect(forecast.getByRole("alert")).toContainText(
    "Payment forecast could not be loaded.",
    { timeout: 15_000 },
  )
  await expect(
    page.getByText("Payment metrics could not be loaded."),
  ).toBeVisible()
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: /Payment (forecast|metrics) could not be loaded/ }),
  ).toHaveCount(1)
})

test("payment forecast only labels dense bars when the plot is wide enough", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-11-03T12:00:00Z"))
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await api(page, "de", "light", "calendar")
  await page.route("**/analytics/cashflow?**", (route) => {
    const month = Number(
      new URL(route.request().url()).searchParams.get("month"),
    )
    return route.fulfill({
      json: {
        period: { year: 2026, month },
        as_of_date: "2026-11-03",
        unknown_amount_count: 0,
        without_due_date_count: 0,
        is_complete: true,
        currency_summaries: (month === 11 ? ["EUR", "USD"] : ["EUR"]).map(
          (currency) => ({
            currency,
            total_known_amount: "98760.00",
            scheduled_known_amount: "98760.00",
            unscheduled_known_amount: "0.00",
            overdue_known_amount: "0.00",
            daily: Array.from({ length: 8 }, (_, i) => ({
              due_date: `2026-${month}-${10 + i}`,
              amount: "12345.00",
              cumulative_amount: String(12345 * (i + 1)),
              is_overdue: month === 10,
            })),
          }),
        ),
      },
    })
  })
  await page.goto("/")
  const forecast = page.getByRole("region", { name: "Zahlungsprognose" })
  const charts = forecast.getByTestId("payment-schedule-chart")
  const chart = charts.first()
  const bars = chart.locator(".recharts-bar-rectangle path")
  const labels = chart.locator(".recharts-label-list text")
  await expect(charts).toHaveCount(2)
  await expect(bars).toHaveCount(8)
  await expect(labels).toHaveCount(0)
  await bars.first().hover()
  await expect(
    chart
      .locator(".recharts-tooltip-wrapper")
      .getByText("12.345,00 EUR", { exact: true }),
  ).toBeVisible()

  await forecast.getByRole("combobox", { name: "Abrechnungszeitraum" }).click()
  await page.getByRole("option", { name: "Oktober 2026" }).click()
  await expect(charts).toHaveCount(1)
  await expect(labels).toHaveCount(8)
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(labels).toHaveCount(0)
  await expect(bars).toHaveCount(8)
})
