import { expect, type Page, test } from "@playwright/test"
import type { OnboardingState } from "../src/client"

test.use({ storageState: { cookies: [], origins: [] } })

async function app(
  page: Page,
  {
    demo = false,
    writes = true,
    saved = {},
  }: { demo?: boolean; writes?: boolean; saved?: OnboardingState } = {},
) {
  const commands: Record<string, unknown>[] = []
  let state: OnboardingState = saved
  const ledger = {
    id: "ledger",
    owner_user_id: "owner",
    name: "Home",
    description: null,
    default_currency: "EUR",
    business_calendar_country: "PL",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  }
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    let json: unknown = { data: [], count: 0 }
    if (path.endsWith("/utils/public-config"))
      json = {
        environment: demo ? "demo" : "local",
        is_demo: demo,
        demo_writes_enabled: writes,
        demo_credentials: null,
      }
    else if (path.endsWith("/users/me"))
      json = {
        id: "owner",
        email: "owner@example.com",
        is_active: true,
        is_superuser: false,
        language: "en",
      }
    else if (path.endsWith("/ledgers/preference-options"))
      json = {
        countries: ["PL", "DE"],
        currencies: ["PLN", "EUR", "USD", "GBP", "CHF"],
        default_business_calendar_country: "PL",
        default_currency: "PLN",
      }
    else if (path.endsWith("/ledgers/") || path.endsWith("/ledgers"))
      json = { data: [ledger], count: 1 }
    else if (path.endsWith("/ledgers/ledger")) json = ledger
    else if (path.endsWith("/onboarding/eligibility/ledger")) json = true
    else if (path.endsWith("/members"))
      json = { data: [{ user_id: "owner", role: "owner" }], count: 1 }
    else if (path.endsWith("/category-groups"))
      json = {
        data: [{ id: "bills", name: "Household bills", is_active: true }],
        count: 1,
      }
    else if (path.endsWith("/schedule-preview"))
      json = {
        period_year: 2026,
        period_month: 11,
        scheduled_date: "2026-11-01",
        due_date: "2026-10-30",
        calendar_country: "PL",
      }
    else if (path.endsWith("/onboarding/")) {
      if (request.method() === "POST") {
        const command = request.postDataJSON()
        commands.push(command)
        if (command.action === "dismiss") state = { ...state, dismissed: true }
        else if (command.action === "category")
          state = { ...state, category: command.category, step: 2 }
        else if (command.action === "schedule")
          state = { ...state, schedule: command.schedule, step: 3 }
        else if (command.action === "payment")
          state = {
            ...state,
            step: 4,
            obligation_key: "INTE-2026-11",
            category: { ...state.category!, code: "INTE" },
          }
        else if (command.action === "ledger")
          state = { ...state, ledger_id: "ledger", step: 1 }
        state = { ...state, revision: (state.revision ?? 0) + 1 }
      }
      json = state
    }
    await route.fulfill({ json })
  })
  return { commands }
}

for (const writes of [true, false]) {
  test(`demo preview completes without writes when demo writes are ${writes}`, async ({
    page,
  }) => {
    const { commands } = await app(page, { demo: true, writes })
    const mutations: string[] = []
    page.on("request", (request) => {
      if (
        ["POST", "PUT", "PATCH", "DELETE"].includes(request.method()) &&
        !request.url().endsWith("/schedule-preview")
      )
        mutations.push(request.url())
    })
    await page.goto("/ledgers/ledger")
    await expect(page.getByRole("dialog")).toHaveCount(0)
    await page.getByRole("button", { name: "Try the setup guide" }).click()
    const dialog = page.getByRole("dialog")
    await expect(
      dialog.getByText(/does not save payments or progress/),
    ).toBeVisible()
    await dialog.getByRole("button", { name: "Continue", exact: true }).click()
    await dialog.getByLabel("Group name", { exact: true }).fill("Bills")
    await dialog.getByRole("button", { name: "Continue", exact: true }).click()
    await dialog.getByLabel("First payment due").fill("2026-11-01")
    await expect(dialog.getByText("30 Oct 2026", { exact: true })).toBeVisible()
    await dialog.getByRole("button", { name: "Continue", exact: true }).click()
    await dialog.getByLabel("Amount for this payment").fill("0")
    await dialog
      .getByLabel("I confirm the amount and due date.", { exact: false })
      .check()
    await dialog
      .getByRole("button", { name: "Create recurring payment" })
      .click()
    await expect(dialog.getByText(/No demo data was changed/)).toBeVisible()
    await dialog
      .getByRole("button", { name: "Close", exact: true })
      .last()
      .click()
    await page.getByRole("button", { name: "Try the setup guide" }).click()
    await expect(
      dialog.getByText("Step 1 of 4", { exact: false }),
    ).toBeVisible()
    expect(commands).toEqual([])
    expect(mutations).toEqual([])
  })
}

test("saved setup resumes after reload and confirms the first payment", async ({
  page,
}) => {
  const { commands } = await app(page, {
    saved: { revision: 1, step: 1, ledger_id: "ledger" },
  })
  await page.goto("/ledgers/ledger")
  await page.getByRole("button", { name: "Continue setup" }).click()
  let dialog = page.getByRole("dialog")
  await dialog.getByLabel("What do you pay for?").fill("Internet")
  await dialog.getByLabel("Group", { exact: true }).selectOption("bills")
  await expect(dialog.getByLabel("Currency", { exact: true })).toHaveText("EUR")
  await dialog.getByRole("button", { name: "Continue", exact: true }).click()
  await dialog.getByLabel("First payment due").fill("2026-11-01")
  await dialog.getByRole("button", { name: "Continue", exact: true }).click()
  await dialog.getByRole("button", { name: "Finish later" }).click()
  await expect(dialog).toHaveCount(0)
  await page.reload()
  await page.getByRole("button", { name: "Continue setup" }).click()
  dialog = page.getByRole("dialog")
  await expect(dialog.getByText("Step 4 of 4", { exact: false })).toBeVisible()
  await expect(
    dialog.getByLabel("I confirm the amount and due date.", { exact: false }),
  ).toBeDisabled()
  await dialog.getByLabel("Amount for this payment").fill("42.50")
  await expect(dialog.getByText("Payment due: 30 Oct 2026")).toBeVisible()
  await dialog
    .getByLabel("I confirm the amount and due date.", { exact: false })
    .check()
  await dialog.getByRole("button", { name: "Create recurring payment" }).click()
  await expect(
    dialog.getByRole("link", { name: "View payment" }),
  ).toHaveAttribute(
    "href",
    "/ledgers/ledger?period=all&lifecycle=&category=INTE",
  )
  expect(commands.map((command) => command.action)).toEqual([
    "category",
    "schedule",
    "dismiss",
    "payment",
  ])
  expect(commands.at(-1)).toMatchObject({
    action: "payment",
    amount: "42.50",
    ready: true,
    revision: 4,
  })
})

test("preview fits a narrow screen and can be closed before saving", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await app(page, { demo: true })
  await page.goto("/ledgers/ledger")
  await page.getByRole("button", { name: "Try the setup guide" }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog).toBeVisible()
  expect(
    await dialog.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true)
  await expect(dialog).toHaveCSS("opacity", "1")
  await page.screenshot({ path: "test-results/onboarding-mobile.png" })
  await page.keyboard.press("Escape")
  await expect(dialog).toHaveCount(0)
})

test("an empty owned workspace offers an optional guide and reuses the ledger", async ({
  page,
}) => {
  const { commands } = await app(page)
  await page.goto("/ledgers/ledger")
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await page.getByRole("button", { name: "Get started", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByText("Step 1 of 4", { exact: false })).toBeVisible()
  await dialog.getByRole("button", { name: "Continue", exact: true }).click()
  await expect(dialog.getByText("Step 2 of 4", { exact: false })).toBeVisible()
  expect(commands).toEqual([
    { action: "ledger", revision: 0, ledger_id: "ledger" },
  ])
})
