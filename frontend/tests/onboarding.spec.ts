import { expect, type Page, type Request, test } from "@playwright/test"
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
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().endsWith("/onboarding/") &&
        response.request().method() === "POST",
    ),
    dialog.getByRole("button", { name: "Finish later" }).click(),
  ])
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
    confirmed_due_date: "2026-10-30",
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

test("the guide closes even if saving the dismissal fails", async ({
  page,
}) => {
  await app(page, { saved: { step: 1, revision: 1, ledger_id: "ledger" } })
  await page.route("**/api/v1/onboarding/", async (route) => {
    if (route.request().method() === "POST") await route.abort("failed")
    else await route.fallback()
  })
  await page.goto("/ledgers/ledger")
  await page.getByRole("button", { name: "Continue setup" }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog).toBeVisible()
  await Promise.all([
    page.waitForEvent("requestfailed", (request) =>
      request.url().endsWith("/onboarding/"),
    ),
    page.keyboard.press("Escape"),
  ])
  await expect(dialog).toHaveCount(0)
  await expect(
    page.getByRole("button", { name: "Continue setup" }),
  ).toBeVisible()
})

test("a changed due date clears the previous confirmation", async ({
  page,
}) => {
  const saved = {
    step: 3,
    revision: 3,
    ledger_id: "ledger",
    business_calendar_country: "PL",
    category: {
      name: "Internet",
      group_name: "Bills",
      currency: "EUR" as const,
    },
    schedule: { first_due_date: "2027-01-06" },
  }
  const { commands } = await app(page, { saved })
  let changed = false
  await page.route("**/api/v1/onboarding/", async (route) => {
    if (route.request().method() === "GET" && changed) {
      await route.fulfill({
        json: { ...saved, business_calendar_country: "DE" },
      })
    } else if (route.request().method() === "POST" && !changed) {
      expect(route.request().postDataJSON().confirmed_due_date).toBe(
        "2027-01-05",
      )
      changed = true
      await route.fulfill({
        status: 409,
        json: {
          code: "onboarding_due_date_changed",
          detail: "Date changed",
          params: {},
        },
      })
    } else await route.fallback()
  })
  await page.route("**/api/v1/onboarding/schedule-preview", async (route) => {
    const country = route.request().postDataJSON().business_calendar_country
    await route.fulfill({
      json: { due_date: country === "DE" ? "2027-01-06" : "2027-01-05" },
    })
  })
  await page.goto("/ledgers/ledger")
  await page.getByRole("button", { name: "Continue setup" }).click()
  const dialog = page.getByRole("dialog")
  const confirm = dialog.getByLabel("I confirm the amount and due date.", {
    exact: false,
  })
  const amount = dialog.getByLabel("Amount for this payment")
  const create = dialog.getByRole("button", {
    name: "Create recurring payment",
  })
  await amount.fill("42.50")
  await expect(dialog.getByText("Payment due: 5 Jan 2027")).toBeVisible()
  await confirm.check()
  await create.click()
  await expect(dialog.getByRole("alert")).toContainText("due date changed")
  await expect(dialog.getByText("Payment due: 6 Jan 2027")).toBeVisible()
  await expect(amount).toHaveValue("42.50")
  await expect(confirm).not.toBeChecked()
  await confirm.check()
  await create.click()
  await expect(dialog.getByRole("link", { name: "View payment" })).toBeVisible()
  expect(commands.at(-1)).toMatchObject({
    action: "payment",
    ready: true,
    confirmed_due_date: "2027-01-06",
  })
})

test("a changed payment category clears another tab's amount and confirmation", async ({
  page,
}) => {
  const saved = {
    step: 3,
    revision: 3,
    ledger_id: "ledger",
    business_calendar_country: "PL",
    category: {
      name: "Internet",
      group_name: "Bills",
      currency: "EUR" as const,
    },
    schedule: { first_due_date: "2026-11-01" },
  }
  await app(page, { saved })
  let changed = false
  await page.route("**/api/v1/onboarding/", async (route) => {
    if (route.request().method() === "GET" && changed) {
      await route.fulfill({
        json: {
          ...saved,
          revision: 7,
          category: { ...saved.category, name: "Rent" },
        },
      })
    } else if (route.request().method() === "POST" && !changed) {
      changed = true
      await route.fulfill({
        status: 409,
        json: {
          code: "onboarding_changed",
          detail: "Setup changed",
          params: {},
        },
      })
    } else await route.fallback()
  })
  await page.goto("/ledgers/ledger")
  await page.getByRole("button", { name: "Continue setup" }).click()
  const dialog = page.getByRole("dialog")
  const amount = dialog.getByLabel("Amount for this payment")
  const confirm = dialog.getByLabel("I confirm the amount and due date.", {
    exact: false,
  })
  await amount.fill("42.50")
  await confirm.check()
  await dialog.getByRole("button", { name: "Create recurring payment" }).click()
  await expect(dialog.getByText("Rent · EUR")).toBeVisible()
  await expect(amount).toHaveValue("")
  await expect(confirm).not.toBeChecked()
})

test("late dismissal cannot restore a draft after switching accounts", async ({
  page,
}) => {
  const draft = {
    step: 3,
    revision: 3,
    ledger_id: "ledger",
    business_calendar_country: "PL",
    category: {
      name: "Previous account draft",
      group_name: "Bills",
      currency: "EUR" as const,
    },
    schedule: { first_due_date: "2026-11-01" },
  }
  await app(page, { saved: draft })
  let account = "owner"
  let releaseDismiss!: () => void
  const held = new Promise<void>((resolve) => {
    releaseDismiss = resolve
  })
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (path.endsWith("/login/logout")) {
      account = ""
      await route.fulfill({ json: {} })
    } else if (path.endsWith("/login/session")) {
      account = "other"
      await route.fulfill({
        json: {},
        headers: {
          "x-csrf-token": "session-b",
          "access-control-expose-headers": "X-CSRF-Token",
        },
      })
    } else if (path.endsWith("/users/me") && account !== "owner") {
      if (!account) {
        await route.fulfill({
          status: 401,
          json: { detail: "Not authenticated" },
        })
      } else {
        await route.fulfill({
          json: {
            id: account,
            email: "other@example.com",
            is_active: true,
            is_superuser: false,
            language: "en",
          },
        })
      }
    } else if (path.endsWith("/onboarding/") && request.method() === "POST") {
      if (account === "other") {
        expect(request.headers()["x-csrf-token"]).toBe("session-b")
        await route.fulfill({
          json: { step: 1, revision: 1, ledger_id: "other-ledger" },
        })
        return
      }
      await held
      await route.fulfill({
        json: { ...draft, revision: 4, dismissed: true },
        headers: {
          "x-csrf-token": "session-a",
          "access-control-expose-headers": "X-CSRF-Token",
        },
      })
    } else if (path.endsWith("/onboarding/") && account === "other") {
      await route.fulfill({ json: { step: 0, revision: 0 } })
    } else if (
      (path.endsWith("/ledgers/") || path.endsWith("/ledgers")) &&
      account === "other"
    ) {
      await route.fulfill({ json: { data: [], count: 0 } })
    } else await route.fallback()
  })
  await page.goto("/ledgers/ledger")
  await page.getByRole("button", { name: "Continue setup" }).click()
  const dialog = page.getByRole("dialog")
  const isDismissRequest = (request: Request) =>
    request.url().endsWith("/onboarding/") && request.method() === "POST"
  await Promise.all([
    page.waitForRequest(isDismissRequest),
    dialog.getByRole("button", { name: "Finish later" }).click(),
  ])
  if ((page.viewportSize()?.width ?? 1280) < 768) {
    await page.getByLabel("More", { exact: true }).click()
  }
  await page.getByTestId("user-menu").filter({ visible: true }).click()
  await page.getByRole("menuitem", { name: "Log Out", exact: true }).click()
  await expect(page).toHaveURL(/\/login$/)
  await page.getByTestId("email-input").fill("other@example.com")
  await page.getByTestId("password-input").fill("test-pass-123")
  await page.getByRole("button", { name: "Log In", exact: true }).click()
  const start = page.getByRole("button", { name: "Get started", exact: true })
  await expect(start).toBeVisible()
  const dismissal = page.waitForResponse((response) =>
    isDismissRequest(response.request()),
  )
  releaseDismiss()
  await (await dismissal).finished()
  await page.waitForLoadState("networkidle")
  await start.click()
  await expect(dialog.getByText("Step 1 of 4", { exact: false })).toBeVisible()
  await expect(dialog.getByText("Previous account draft · EUR")).toHaveCount(0)
  await dialog.getByLabel("Workspace name").fill("New household")
  await dialog.getByRole("button", { name: "Continue", exact: true }).click()
  await expect(dialog.getByText("Step 2 of 4", { exact: false })).toBeVisible()
})
