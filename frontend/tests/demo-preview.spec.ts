import { expect, type Page, test } from "@playwright/test"

test.use({ storageState: { cookies: [], origins: [] } })
const ledgerId = "11111111-1111-4111-8111-111111111111"
const categoryId = "33333333-3333-4333-8333-333333333333"
const userId = "22222222-2222-4222-8222-222222222222"

async function mockApi(page: Page, demo = true, readOnly = false) {
  const restrictedRequests: string[] = []
  const writes: string[] = []
  await page.addInitScript(() => localStorage.setItem("oblidog-language", "en"))
  await page.route("**/api/v1/**", async (route) => {
    const req = route.request()
    const path = new URL(req.url()).pathname.replace(/\/$/, "")
    const send = (json: unknown, status = 200) =>
      route.fulfill({ status, json })
    if (req.method() === "OPTIONS") return send({})
    if (!["GET", "HEAD"].includes(req.method())) writes.push(path)
    if (path.endsWith("/utils/public-config"))
      return send({
        environment: demo ? "demo" : "local",
        is_demo: demo,
        demo_writes_enabled: !readOnly,
        demo_credentials: null,
      })
    if (path.endsWith("/users/me"))
      return send({
        id: userId,
        email: "demo@oblidog.com",
        full_name: "Demo User",
        is_active: true,
        is_superuser: false,
        language: "en",
      })
    const ledger = {
      id: ledgerId,
      owner_user_id: userId,
      name: "Home",
      description: "Demo workspace",
      is_active: true,
      business_calendar_country: "PL",
      default_currency: "PLN",
      created_at: "2026-01-01T00:00:00Z",
    }
    if (path === "/api/v1/ledgers") return send({ data: [ledger], count: 1 })
    if (path === `/api/v1/ledgers/${ledgerId}`) return send(ledger)
    if (path.endsWith("/preference-options"))
      return send({ countries: ["PL", "GB"], currencies: ["PLN", "EUR"] })
    if (path.endsWith("/members")) return send({ data: [], count: 0 })
    if (path.endsWith("/categories"))
      return send({
        data: [
          {
            id: categoryId,
            ledger_id: ledgerId,
            name: "Electricity",
            code: "ELEC",
            is_active: true,
          },
        ],
        count: 1,
      })
    const integration = {
      id: categoryId,
      ledger_id: ledgerId,
      category_id: categoryId,
      name: "Electricity",
      credentials: [],
      enabled: true,
      health: "healthy",
      execution_state: "finished",
      revision: 1,
      run_timeout_seconds: 300,
      stale_after_seconds: 172800,
      is_stale: false,
      created_at: "2026-01-01T07:30:00Z",
      updated_at: "2026-01-01T07:30:18Z",
      current_run_id: userId,
      current_started_at: "2026-01-01T07:30:00Z",
      current_finished_at: "2026-01-01T07:30:18Z",
      current_deadline_at: "2026-01-01T07:35:00Z",
      last_finished_at: "2026-01-01T07:30:18Z",
      last_success_at: "2026-01-01T07:30:18Z",
      last_result: "success",
      last_changes_detected: true,
      last_error_code: null,
      last_error_message: null,
    }
    if (
      path.endsWith(`/integrations/${categoryId}/runs`) &&
      req.method() === "GET"
    )
      return send({
        count: 1,
        data: [
          {
            id: userId,
            integration_id: categoryId,
            started_at: integration.current_started_at,
            finished_at: integration.current_finished_at,
            deadline_at: integration.current_deadline_at,
            result: "success",
            changes_detected: true,
            error_code: null,
            error_message: null,
          },
        ],
      })
    if (path.endsWith(`/integrations/${categoryId}`) && req.method() === "GET")
      return send(integration)
    if (path.endsWith("/integrations") && req.method() === "GET")
      return send({ data: [integration], count: 1 })
    if (path.includes("/integrations") || path.includes("/system-runs")) {
      restrictedRequests.push(path)
      return send({ detail: "Forbidden" }, 403)
    }
    if (path.endsWith("/report-preferences"))
      return send({ daily_report_enabled: true, weekly_report_enabled: true })
    return send({ data: [], count: 0 })
  })
  return { restrictedRequests, writes }
}

function indicator(page: Page) {
  return page.getByTestId("demo-indicator").filter({ visible: true })
}

async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
}

test("demo settings remain readable and every modifying control is disabled", async ({
  page,
}) => {
  const { writes } = await mockApi(page)
  await page.goto(`/ledgers/${ledgerId}/settings`)
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Home")
  await expect(page.getByLabel("Name", { exact: true })).toBeDisabled()
  await expect(
    page.getByRole("button", { name: "Save details" }),
  ).toBeDisabled()
  await expect(
    page.getByLabel("Holiday calendar", { exact: true }),
  ).toBeDisabled()
  await expect(
    page.getByRole("button", { name: "Share ledger", exact: true }),
  ).toBeDisabled()
  await expect(
    page.getByRole("button", { name: "Delete all obligations", exact: true }),
  ).toBeDisabled()
  await noOverflow(page)

  await page.goto("/settings")
  await expect(
    page.getByRole("button", { name: "Edit", exact: true }),
  ).toBeDisabled()
  await page.getByRole("tab", { name: "Password", exact: true }).click()
  await expect(page.getByTestId("new-password-input")).toBeDisabled()
  await page.getByRole("tab", { name: "Reports", exact: true }).click()
  await expect(page.getByRole("checkbox").first()).toBeDisabled()
  await expect(page.getByRole("checkbox").first()).toBeChecked()
  await page.getByRole("tab", { name: "Danger zone", exact: true }).click()
  await expect(
    page.getByRole("button", { name: /^delete account$/i }),
  ).toBeDisabled()
  await noOverflow(page)
  expect(writes).toEqual([])
})

test("integration and System Run previews never call restricted APIs", async ({
  page,
}) => {
  const { restrictedRequests, writes } = await mockApi(page)
  await page.goto(`/ledgers/${ledgerId}/integrations`)
  await expect(page.getByTestId("demo-preview-notice")).toContainText(
    "illustrative records",
  )
  await expect(
    page.getByRole("button", { name: "Add integration", exact: true }),
  ).toBeDisabled()
  await page.getByRole("link", { name: "Electricity", exact: true }).click()
  await expect(
    page.getByRole("heading", { name: "Electricity", exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Generate new key", exact: true }),
  ).toBeDisabled()
  await expect(
    page
      .getByRole("list", { name: "Integration runs", exact: true })
      .locator("li"),
  ).toHaveCount(1)
  await page.getByRole("button", { name: "Configure", exact: true }).click()
  await expect(
    page
      .getByRole("dialog")
      .getByRole("button", { name: "Save changes", exact: true }),
  ).toBeDisabled()
  await page.getByRole("button", { name: "Close", exact: true }).click()
  await noOverflow(page)

  await page.goto(`/ledgers/${ledgerId}/system-run`)
  await expect(page.getByTestId("demo-preview-notice")).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Start System Run", exact: true }),
  ).toBeDisabled()
  await expect(page.getByText("Run history", { exact: true })).toBeVisible()
  await expect(page.locator("main main section")).toHaveCount(1)
  await noOverflow(page)
  expect(restrictedRequests).toEqual([])
  expect(writes).toEqual([])
})

test("compact indicator explains demo and screenshot CSS does not shift the page", async ({
  page,
}) => {
  await mockApi(page)
  await page.goto("/settings")
  await expect(page.getByTestId("demo-banner")).toHaveCount(0)
  await indicator(page).click()
  await expect(page.getByRole("dialog")).toContainText(
    "shared demo environment",
  )
  await expect(page.getByRole("dialog")).toContainText("periodically reset")
  await page.getByRole("button", { name: "Close", exact: true }).click()
  const before = await page.locator("main main").boundingBox()
  await page.screenshot({
    path: test.info().outputPath("demo-settings.png"),
    animations: "disabled",
    style: '[data-testid="demo-indicator"] { display: none !important; }',
  })
  expect(await page.locator("main main").boundingBox()).toEqual(before)
  await expect(indicator(page)).toBeVisible()
  await noOverflow(page)
})

test("read-only demo has a persistent explicit label", async ({ page }) => {
  await mockApi(page, true, true)
  await page.goto("/settings")
  await expect(indicator(page)).toContainText("Read-only")
  await indicator(page).click()
  await expect(page.getByRole("dialog")).toContainText("temporarily read-only")
})

test("normal installations keep writable settings and no demo decoration", async ({
  page,
}) => {
  await mockApi(page, false)
  await page.goto(`/ledgers/${ledgerId}/settings`)
  await expect(page.getByLabel("Name", { exact: true })).toBeEnabled()
  await expect(page.getByRole("button", { name: "Save details" })).toBeEnabled()
  await expect(page.getByTestId("demo-indicator")).toHaveCount(0)
  await page.goto("/settings")
  await expect(
    page.getByRole("button", { name: "Edit", exact: true }),
  ).toBeEnabled()
})
