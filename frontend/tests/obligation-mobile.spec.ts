import { expect, type Page, test } from "@playwright/test"
import type { ObligationPublic } from "../src/client"

// These browser tests isolate the mobile UI from database fixtures. API and
// authorization enforcement are covered by the existing backend/e2e suites.
test.use({ storageState: { cookies: [], origins: [] } })

const ledgerId = "mobile-ledger"
const name = "Electricity with a long category name"
const key = "ELEC-2026-10"

async function mockWorkspace(
  page: Page,
  options: {
    viewer?: boolean
    lifecycle?: ObligationPublic["lifecycle"]
    incomplete?: boolean
    readOnly?: boolean
    secondObligation?: boolean
  } = {},
) {
  const obligation: ObligationPublic = {
    id: "mobile-obligation",
    ledger_id: ledgerId,
    category_id: "category",
    counterparty_id: null,
    counterparty: null,
    category_code: "ELEC",
    key,
    name,
    notes: `Invoice reference ${"X".repeat(120)}`,
    lifecycle: options.lifecycle ?? "draft",
    period: { year: 2026, month: 10 },
    effective_value_source: "manual",
    current_amount: options.incomplete ? null : "125.00",
    amount_state: options.incomplete ? "unknown" : "confirmed",
    amount_source: "manual",
    issue_date: "2026-10-01",
    issue_date_state: "confirmed",
    issue_date_source: "manual",
    due_date: "2026-10-20",
    due_date_state: "confirmed",
    due_date_source: "manual",
    currency: "PLN",
    paid_at: null,
    created_at: "2026-10-01T12:00:00Z",
    updated_at: "2026-10-01T12:00:00Z",
  }
  const secondObligation: ObligationPublic = {
    ...obligation,
    id: "second-obligation",
    category_id: "second-category",
    category_code: "GAS",
    key: "GAS-2026-10",
    name: "Gas bill",
  }
  const ledger = {
    id: ledgerId,
    owner_user_id: "owner",
    name: "Mobile ledger",
    description: null,
  }
  const mutations: string[] = []
  const unexpected: string[] = []
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname
    if (route.request().method() !== "GET") {
      mutations.push(path)
      if (path.endsWith("/ready")) obligation.lifecycle = "ready"
      else if (path.endsWith("/mark-paid")) {
        obligation.lifecycle = "paid"
        obligation.paid_at = "2026-10-06T12:00:00Z"
      } else if (path.endsWith(`/obligations/${key}`)) {
        obligation.current_amount = route
          .request()
          .postDataJSON().current_amount
        obligation.amount_state = "confirmed"
      } else unexpected.push(path)
      await route.fulfill({ json: obligation })
      return
    }
    let json: unknown
    if (path.endsWith("/utils/public-config"))
      json = {
        environment: options.readOnly ? "demo" : "local",
        is_demo: !!options.readOnly,
        demo_writes_enabled: !options.readOnly,
        demo_credentials: null,
      }
    else if (path.endsWith("/users/me"))
      json = {
        id: options.viewer ? "viewer" : "owner",
        email: "mobile@example.com",
        is_active: true,
        is_superuser: false,
      }
    else if (path.endsWith(`/ledgers/${ledgerId}`)) json = ledger
    else if (path.endsWith("/ledgers/") || path.endsWith("/ledgers"))
      json = { data: [ledger], count: 1 }
    else if (path.endsWith("/members"))
      json = { data: [{ user_id: "viewer", role: "viewer" }], count: 1 }
    else if (path.endsWith(`/obligations/${key}`)) json = obligation
    else if (path.endsWith("/obligations"))
      json = {
        data: options.secondObligation
          ? [obligation, secondObligation]
          : [obligation],
        count: options.secondObligation ? 2 : 1,
      }
    else if (path.endsWith("/actions") || path.endsWith("/categories"))
      json = { data: [], count: 0 }
    else {
      unexpected.push(path)
      json = { data: [], count: 0 }
    }
    await route.fulfill({ json })
  })
  return { obligation, mutations, unexpected }
}

async function openWorkspace(page: Page) {
  await page.goto(
    `/ledgers/${ledgerId}?year=2026&month=10&category=ELEC&lifecycle=unpaid`,
  )
  await expect(page.getByText(name, { exact: true })).toBeVisible()
}

async function expectNoOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)
}

for (const width of [320, 375, 414]) {
  test(`phone workflow at ${width}px preserves filters and prevents duplicate payment`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 })
    const fixture = await mockWorkspace(page)
    await openWorkspace(page)
    await expectNoOverflow(page)
    const ready = page.getByRole("button", {
      name: "Mark as ready",
      exact: true,
    })
    expect((await ready.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    await ready.click()
    await expect(
      page.getByRole("button", { name: "Mark as paid", exact: true }),
    ).toBeVisible()
    expect(fixture.mutations.filter((p) => p.endsWith("/ready"))).toHaveLength(
      1,
    )
    await page.getByText(name, { exact: true }).click()
    const details = page.getByRole("dialog", { name: key })
    await expect(details.getByText("125.00 PLN", { exact: true })).toBeVisible()
    await expect(details.getByText("2026-10-20", { exact: true })).toBeVisible()
    await expectNoOverflow(page)
    expect(
      await details
        .locator("table")
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true)
    await details.getByRole("tab", { name: "Activity" }).click()
    await expect(
      details.getByRole("region", { name: "Action history" }),
    ).toBeVisible()
    await details
      .getByRole("button", { name: "Mark as paid", exact: true })
      .click()
    const confirmation = page.getByRole("dialog", {
      name: "Mark obligation as paid?",
    })
    await confirmation
      .getByRole("button", { name: "Cancel", exact: true })
      .click()
    expect(
      fixture.mutations.filter((p) => p.endsWith("/mark-paid")),
    ).toHaveLength(0)
    await details
      .getByRole("button", { name: "Mark as paid", exact: true })
      .click()
    // Delayed failure lets us exercise the disabled state and same-tick taps.
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let attempts = 0
    await page.route("**/mark-paid*", async (route) => {
      attempts += 1
      await gate
      await route.fulfill({
        status: 500,
        json: { detail: "Payment failed. Try again." },
      })
    })
    const pay = confirmation.getByRole("button", {
      name: "Mark as paid",
      exact: true,
    })
    await expect(pay).toBeEnabled()
    await pay.evaluate((button) => {
      ;(button as HTMLButtonElement).click()
      ;(button as HTMLButtonElement).click()
    })
    await expect(pay).toBeDisabled()
    await expect.poll(() => attempts).toBe(1)
    release()
    await expect(
      page.getByText("Payment failed. Try again.", { exact: true }),
    ).toBeVisible()
    await expect(pay).toBeEnabled()
    await expect(confirmation).toBeVisible()
    await page.unroute("**/mark-paid*")
    await pay.click()
    await expect(confirmation).toBeHidden()
    await details.getByRole("button", { name: "Close", exact: true }).click()
    await expect(page.getByLabel("Category code")).toHaveValue("ELEC")
    await expect(page.getByLabel("Lifecycle")).toHaveValue("unpaid")
    await expect(page.getByLabel("Billing period")).toHaveValue("2026-10")
    await expect(
      page.getByRole("button", { name: "Mark as paid", exact: true }),
    ).toHaveCount(0)
    await expectNoOverflow(page)
    expect(
      fixture.mutations.filter((p) => p.endsWith("/mark-paid")),
    ).toHaveLength(1)
    expect(fixture.unexpected).toEqual([])
  })
}

test("incomplete draft exposes data completion before readiness", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 844 })
  const fixture = await mockWorkspace(page, { incomplete: true })
  await openWorkspace(page)
  await expect(
    page.getByRole("button", { name: "Mark as ready", exact: true }),
  ).toHaveCount(0)
  await page.getByRole("button", { name: "Complete data", exact: true }).click()
  const edit = page.getByRole("dialog", { name: "Edit obligation" })
  await edit.getByLabel("Current amount", { exact: true }).fill("125.00")
  await edit
    .getByRole("button", { name: "Save changes" })
    .evaluate((button) => {
      ;(button as HTMLButtonElement).click()
      ;(button as HTMLButtonElement).click()
    })
  await expect(edit).toBeHidden()
  await expect(
    page.getByRole("button", { name: "Mark as ready", exact: true }),
  ).toBeVisible()
  expect(fixture.mutations).toHaveLength(1)
})

for (const options of [{ viewer: true }, { readOnly: true }]) {
  test(`read access hides mutations: ${JSON.stringify(options)}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 844 })
    const fixture = await mockWorkspace(page, {
      ...options,
      lifecycle: "ready",
    })
    await openWorkspace(page)
    await expect(
      page.getByRole("button", { name: "New obligation" }),
    ).toHaveCount(0)
    await expect(
      page.getByRole("button", { name: "Mark as paid", exact: true }),
    ).toHaveCount(0)
    await page.getByText(name, { exact: true }).click()
    const details = page.getByRole("dialog", { name: key })
    await expect(
      details.getByRole("button", { name: "Mark as paid", exact: true }),
    ).toHaveCount(0)
    await details.getByRole("tab", { name: "Activity" }).click()
    await expect(
      details.getByRole("region", { name: "Action history" }),
    ).toBeVisible()
    expect(fixture.mutations).toEqual([])
  })
}

for (const lifecycle of [
  "collecting_data",
  "ready",
  "paid",
  "canceled",
  "error",
] as const) {
  test(`mobile actions respect ${lifecycle} lifecycle`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 844 })
    await mockWorkspace(page, { lifecycle })
    await page.goto(`/ledgers/${ledgerId}?year=2026&month=10&lifecycle=`)
    await page.getByText(name, { exact: true }).click()
    const details = page.getByRole("dialog", { name: key })
    await expect(
      details.getByRole("button", { name: "Mark as ready", exact: true }),
    ).toHaveCount(lifecycle === "collecting_data" ? 1 : 0)
    await expect(
      details.getByRole("button", { name: "Mark as paid", exact: true }),
    ).toHaveCount(lifecycle === "ready" ? 1 : 0)
    await expect(
      details.getByRole("button", { name: "Reopen", exact: true }),
    ).toHaveCount(lifecycle === "collecting_data" ? 0 : 1)
    await expectNoOverflow(page)
  })
}

test("failed detail request exposes a retry without losing list context", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 844 })
  await mockWorkspace(page)
  await openWorkspace(page)
  await page.route(new RegExp(`/obligations/${key}\\?`), (route) =>
    route.fulfill({ status: 500, json: { detail: "Details unavailable" } }),
  )
  await page.getByText(name, { exact: true }).click()
  const details = page.getByRole("dialog")
  await expect(details.getByRole("alert")).toHaveText(
    "Unable to load obligation details.",
    { timeout: 15000 },
  )
  await page.unroute(new RegExp(`/obligations/${key}\\?`))
  await details.getByRole("button", { name: "Try again" }).click()
  await expect(details.getByRole("tab", { name: "Details" })).toBeVisible()
  await expectNoOverflow(page)
})

for (const fail of [false, true]) {
  test(`only the active obligation shows a spinner after ${fail ? "failed" : "successful"} submission`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 844 })
    const fixture = await mockWorkspace(page, { secondObligation: true })
    await page.goto(`/ledgers/${ledgerId}?year=2026&month=10&lifecycle=unpaid`)
    const activeTile = page
      .locator(".rounded-xl")
      .filter({ has: page.getByText(name, { exact: true }) })
    const otherTile = page
      .locator(".rounded-xl")
      .filter({ has: page.getByText("Gas bill", { exact: true }) })
    const activeButton = activeTile.getByRole("button", {
      name: "Mark as ready",
      exact: true,
    })
    const otherButton = otherTile.getByRole("button", {
      name: "Mark as ready",
      exact: true,
    })
    await expect(activeButton).toBeEnabled()
    await expect(otherButton).toBeEnabled()
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let requests = 0
    await page.route("**/ready*", async (route) => {
      requests += 1
      await gate
      if (fail)
        await route.fulfill({
          status: 500,
          json: { detail: "Unable to mark ready" },
        })
      else await route.fallback()
    })
    await activeButton.evaluate((button) => {
      ;(button as HTMLButtonElement).click()
      ;(button as HTMLButtonElement).click()
    })
    await expect(activeButton).toBeDisabled()
    await expect(otherButton).toBeDisabled()
    await expect(activeButton.locator(".animate-spin")).toHaveCount(1)
    await expect(otherButton.locator(".animate-spin")).toHaveCount(0)
    // A blocked sibling must not start another mutation even when clicked directly.
    await otherButton.evaluate((button) =>
      (button as HTMLButtonElement).click(),
    )
    await expect.poll(() => requests).toBe(1)
    release()
    await expect(otherButton).toBeEnabled()
    await expect(activeTile.locator(".animate-spin")).toHaveCount(0)
    await expect(otherTile.locator(".animate-spin")).toHaveCount(0)
    await expect(
      activeTile.getByRole("button", {
        name: fail ? "Mark as ready" : "Mark as paid",
        exact: true,
      }),
    ).toBeEnabled()
    expect(requests).toBe(1)
    expect(
      fixture.mutations.filter((path) => path.endsWith("/ready")),
    ).toHaveLength(fail ? 0 : 1)
  })
}
