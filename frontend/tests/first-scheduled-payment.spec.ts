import { expect, type Page, test } from "@playwright/test"
import type { CategoryPublic, ObligationPublic } from "../src/client"

test.use({ storageState: { cookies: [], origins: [] } })

const ledgerId = "first-payment-ledger"
const ledgerPath = `/ledgers/${ledgerId}`
const group = { id: "bills", name: "Household", is_active: true }
const category = {
  id: "internet",
  code: "INET",
  name: "Home internet",
  category_group_id: group.id,
  data_source_policy: "hybrid",
  first_due_date: "2026-11-01",
  recurrence_interval: 1,
  recurrence_unit: "month",
  currency: "PLN",
  is_active: true,
} satisfies Partial<CategoryPublic>
const obligation = {
  id: "first-obligation",
  ledger_id: ledgerId,
  counterparty_id: null,
  counterparty: null,
  notes: null,
  current_amount: null,
  amount_source: "unknown",
  amount_state: "unknown",
  issue_date: null,
  issue_date_source: "unknown",
  issue_date_state: "unknown",
  paid_at: null,
  created_at: "2026-11-01T00:00:00Z",
  updated_at: "2026-11-01T00:00:00Z",
  key: "INET-2026-11",
  category_id: category.id,
  category_code: category.code,
  name: category.name,
  period: { year: 2026, month: 11 },
  lifecycle: "collecting_data",
  currency: "PLN",
  due_date: "2026-10-30",
  due_date_source: "automatic",
  due_date_state: "estimated",
  effective_value_source: "automatic",
} satisfies ObligationPublic

async function mockWorkspace(
  page: Page,
  {
    empty = false,
    firstExists = false,
    racesWithScheduler = false,
    automatic = false,
    firstDueDate = category.first_due_date,
    otherPayments = [] as ObligationPublic[],
    unscheduled = false,
    viewer = false,
    language = "en",
  } = {},
) {
  let ledgers = !empty
  let groups = !empty
  let categories = !empty
  let exists = firstExists
  let savedObligation: ObligationPublic = obligation
  const savedCategory = {
    ...category,
    data_source_policy: automatic ? "automatic" : category.data_source_policy,
    first_due_date: unscheduled ? null : firstDueDate,
  }
  const submissions: unknown[] = []
  const ledger = {
    id: ledgerId,
    name: "Household ledger",
    owner_user_id: "owner",
    default_currency: "PLN",
    business_calendar_country: "PL",
    created_at: "2026-10-01T00:00:00Z",
  }
  await page.addInitScript((lang) => {
    localStorage.setItem("oblidog-language", lang)
  }, language)
  await page.route("**/api/v1/**", (route) => {
    const request = route.request()
    const { pathname, searchParams } = new URL(request.url())
    const path = pathname.replace(/\/$/, "")
    const post = request.method() === "POST"
    const send = (json: unknown, status = 200) =>
      route.fulfill({ json, status })
    const list = (data: unknown[]) => send({ data, count: data.length })
    if (path.endsWith("/utils/public-config")) {
      return send({
        environment: "local",
        is_demo: false,
        demo_writes_enabled: false,
      })
    }
    if (path.endsWith("/users/me")) {
      return send({
        id: viewer ? "viewer" : "owner",
        email: "owner@example.com",
        is_active: true,
        language,
      })
    }
    if (path.endsWith("/ledgers/preference-options")) {
      return send({
        countries: ["PL"],
        currencies: ["PLN"],
        default_business_calendar_country: "PL",
        default_currency: "PLN",
      })
    }
    if (path.endsWith("/ledgers")) {
      if (post) {
        ledgers = true
        return send(ledger)
      }
      return list(ledgers ? [ledger] : [])
    }
    if (path.endsWith(ledgerPath)) return send(ledger)
    if (path.endsWith("/members")) {
      return list(viewer ? [{ user_id: "viewer", role: "viewer" }] : [])
    }
    if (path.endsWith("/category-groups")) {
      if (post) {
        groups = true
        return send(group)
      }
      return list(groups ? [group] : [])
    }
    if (path.endsWith("/categories")) {
      if (post) {
        expect(request.postDataJSON()).toMatchObject({
          category_group_id: group.id,
          first_due_date: category.first_due_date,
          data_source_policy: "hybrid",
        })
        categories = true
        return send(savedCategory)
      }
      return list(categories ? [savedCategory] : [])
    }
    if (path.endsWith("/schedule-preview")) {
      return send({
        period_year: 2026,
        period_month: 11,
        scheduled_date: "2026-11-01",
        due_date: "2026-10-30",
        calendar_country: "PL",
      })
    }
    if (path.endsWith("/obligations")) {
      if (!post) {
        const year = searchParams.get("year")
        const month = searchParams.get("month")
        const payments = exists
          ? [...otherPayments, savedObligation]
          : otherPayments
        return list(
          payments
            .filter(
              ({ period }) =>
                (!year || period.year === Number(year)) &&
                (!month || period.month === Number(month)),
            )
            .sort((a, b) => b.key.localeCompare(a.key)),
        )
      }
      submissions.push(request.postDataJSON())
      exists = true
      if (racesWithScheduler) return send({ code: "obligation_conflict" }, 409)
      return send(savedObligation)
    }
    if (path.endsWith(`/obligations/${obligation.key}`)) {
      if (!exists) return send({ code: "obligation_not_found" }, 404)
      if (request.method() === "PATCH") {
        expect(request.postDataJSON()).toEqual({ current_amount: "49.99" })
        savedObligation = {
          ...savedObligation,
          current_amount: "49.99",
          amount_state: "estimated",
          amount_source: "manual",
        }
      }
      return send(savedObligation)
    }
    if (path.includes("/onboarding")) return send({ dismissed: true })
    return list([])
  })
  return submissions
}

test("creates the first recurring payment through the ordinary forms and reopens it", async ({
  page,
}) => {
  test.slow()
  const submissions = await mockWorkspace(page, { empty: true })
  await page.goto("/ledgers")
  const dialog = page.getByRole("dialog")
  await page.getByRole("button", { name: "New ledger", exact: true }).click()
  await dialog.getByLabel("Name", { exact: true }).fill("Household ledger")
  await dialog
    .getByRole("button", { name: "Create ledger", exact: true })
    .click()
  await page.getByRole("link", { name: /Household ledger/ }).click()

  await page.getByRole("link", { name: "Add your first category" }).click()
  await expect(page.getByText(/A category needs an active group/)).toBeVisible()
  await page.getByRole("button", { name: "New group", exact: true }).click()
  await dialog.getByLabel("Name", { exact: true }).fill(group.name)
  await dialog
    .getByRole("button", { name: "Create group", exact: true })
    .click()

  await page.getByRole("button", { name: "New category", exact: true }).click()
  await dialog.getByLabel("Group", { exact: true }).click()
  await page.getByRole("option", { name: group.name }).click()
  await dialog.getByLabel("Name", { exact: true }).fill(category.name)
  await dialog.getByLabel("Code", { exact: true }).fill(category.code)
  await dialog.getByLabel("First payment due").fill(category.first_due_date)
  await expect(dialog.getByText(/without an integration/)).toBeVisible()
  await dialog
    .getByRole("button", { name: "Create category", exact: true })
    .click()

  await expect(page.getByText(`Next step for ${category.name}`)).toBeVisible()
  await page
    .getByRole("link", { name: `First payment for ${category.name}` })
    .click()
  await expect(dialog.getByLabel("Category", { exact: true })).toHaveValue(
    category.code,
  )
  await expect(
    dialog.getByLabel("Billing period", { exact: true }),
  ).toHaveValue("2026-11")
  await expect(
    dialog.getByText(/when the amount and due date are confirmed/),
  ).toBeVisible()
  await dialog
    .getByRole("button", { name: "Create obligation", exact: true })
    .click()
  await expect(
    dialog.getByRole("heading", { name: category.name }),
  ).toBeVisible()
  expect(submissions).toEqual([
    {
      category_code: category.code,
      period: obligation.period,
      data_ready: false,
    },
  ])

  await page.goto(`${ledgerPath}/categories`)
  await page
    .getByRole("link", { name: `First payment for ${category.name}` })
    .click()
  await expect(
    dialog.getByRole("heading", { name: category.name }),
  ).toBeVisible()
  await page.reload()
  await expect(
    dialog.getByRole("heading", { name: category.name }),
  ).toBeVisible()
  expect(submissions).toHaveLength(1)
})

test("opens the obligation if the scheduler creates it before form submission", async ({
  page,
}) => {
  const submissions = await mockWorkspace(page, { racesWithScheduler: true })
  await page.goto(
    `${ledgerPath}?year=2026&month=11&category=INET&firstPayment=INET`,
  )
  const dialog = page.getByRole("dialog")
  await dialog
    .getByRole("button", { name: "Create obligation", exact: true })
    .click()
  await expect(
    dialog.getByRole("heading", { name: category.name }),
  ).toBeVisible()
  expect(submissions).toHaveLength(1)
  await dialog.getByRole("button", { name: "Close", exact: true }).click()
  const row = page
    .getByTestId(/obligation-(row|card)$/)
    .filter({ hasText: obligation.key })
  await expect(row).toBeVisible()
  await row.getByText(category.name, { exact: true }).click()

  await dialog.getByRole("button", { name: "Edit", exact: true }).click()
  const edit = page.getByRole("dialog", { name: "Edit obligation" })
  await expect(edit.getByLabel("Due date")).toHaveValue("2026-10-30")
  await edit.getByLabel("Current amount").fill("49.99")
  await edit.getByRole("button", { name: "Save changes" }).click()
  await expect(edit).toHaveCount(0)
  await expect(
    dialog
      .getByRole("region", { name: "Payment summary" })
      .getByText("49.99 PLN"),
  ).toBeVisible()
})

for (const [language, label] of [
  ["pl", "Pierwsza płatność dla kategorii Home internet"],
  ["de", "Erste Zahlung für Home internet"],
] as const) {
  test(`${language}: opens a generated payment from the category`, async ({
    page,
  }) => {
    const submissions = await mockWorkspace(page, {
      firstExists: true,
      automatic: true,
      language,
    })
    await page.goto(`${ledgerPath}/categories`)
    await page.getByRole("link", { name: label }).click()
    await expect(
      page.getByRole("dialog").getByRole("heading", { name: category.name }),
    ).toBeVisible()
    expect(submissions).toHaveLength(0)
  })
}

test("opens the earliest recorded automatic payment after an ungenerated anchor", async ({
  page,
}) => {
  const submissions = await mockWorkspace(page, {
    automatic: true,
    firstExists: true,
    firstDueDate: "2026-09-01",
    otherPayments: [
      {
        ...obligation,
        id: "earlier",
        key: "INET-2026-08",
        period: { year: 2026, month: 8 },
      },
      {
        ...obligation,
        id: "later",
        key: "INET-2026-12",
        period: { year: 2026, month: 12 },
      },
    ],
  })
  await page.goto(`${ledgerPath}/categories`)
  await page
    .getByRole("link", { name: `First payment for ${category.name}` })
    .click()
  const dialog = page.getByRole("dialog")
  await expect(
    dialog
      .getByRole("region", { name: "Payment summary" })
      .getByText(obligation.key),
  ).toBeVisible()
  await dialog.getByRole("button", { name: "Close", exact: true }).click()
  await expect(
    page
      .getByTestId(/obligation-(row|card)$/)
      .filter({ hasText: obligation.key }),
  ).toBeVisible()
  expect(submissions).toHaveLength(0)
})

test("offers schedule setup for a category without a first due date", async ({
  page,
}) => {
  await mockWorkspace(page, { unscheduled: true })
  await page.goto(`${ledgerPath}/categories`)
  await expect(
    page.getByRole("link", { name: /First payment for/ }),
  ).toHaveCount(0)
  await page
    .getByRole("button", { name: `Set up schedule for ${category.name}` })
    .click()
  await expect(
    page.getByRole("dialog").getByLabel("First payment due"),
  ).toBeVisible()
})

test("does not offer the creation form to a viewer", async ({ page }) => {
  const submissions = await mockWorkspace(page, { viewer: true })
  await page.goto(`${ledgerPath}?firstPayment=INET`)
  await expect(
    page.getByText(/The first payment cannot be opened/),
  ).toBeVisible()
  await expect(page.getByRole("dialog")).toHaveCount(0)
  expect(submissions).toHaveLength(0)
})
