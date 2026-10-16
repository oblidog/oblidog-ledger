import { expect, type Page, test } from "@playwright/test"

test.use({ storageState: { cookies: [], origins: [] } })
const ledgerId = "11111111-1111-4111-8111-111111111111",
  userId = "22222222-2222-4222-8222-222222222222"
const ledger = {
  id: ledgerId,
  owner_user_id: userId,
  name: "Home_ledger",
  description: "My unchanged notes",
  is_active: true,
  business_calendar_country: "PL",
  default_currency: "PLN",
  created_at: "2026-01-01T00:00:00Z",
}
async function api(page: Page, signedIn: boolean, demo = false) {
  let user = {
    id: userId,
    email: "user@example.com",
    full_name: "Test_User",
    is_active: true,
    is_superuser: false,
    language: "en",
    created_at: "2026-01-01T00:00:00Z",
  }
  const writes: unknown[] = []
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname
    const send = (json: unknown, status = 200) =>
      route.fulfill({
        status,
        json,
        headers: {
          "access-control-allow-origin": "http://localhost:5173",
          "access-control-allow-credentials": "true",
        },
      })
    if (request.method() === "OPTIONS") return send({})
    if (path.endsWith("/utils/public-config"))
      return send({
        environment: demo ? "demo" : "local",
        is_demo: demo,
        demo_writes_enabled: true,
        demo_credentials: null,
      })
    if (path.endsWith("/users/me")) {
      if (!signedIn) return send({ detail: "Not authenticated" }, 401)
      if (request.method() === "PATCH") {
        writes.push(request.postDataJSON())
        user = { ...user, ...request.postDataJSON() }
      }
      return send(user)
    }
    if (path.replace(/\/$/, "") === "/api/v1/ledgers")
      return send({ data: [ledger], count: 1 })
    if (path === `/api/v1/ledgers/${ledgerId}`) return send(ledger)
    if (path.endsWith("/preference-options"))
      return send({ countries: ["PL", "GB"], currencies: ["PLN", "EUR"] })
    if (path.includes("category-groups"))
      return send({
        data: [
          {
            id: "group",
            name: "Custom_group",
            description: null,
            is_active: true,
          },
        ],
        count: 1,
      })
    if (path.replace(/\/$/, "").endsWith("/categories"))
      return send({
        data: [
          {
            id: "category",
            ledger_id: ledgerId,
            category_group_id: "group",
            name: "Custom_category",
            code: "ELEC",
            description: "ready_manual_notes",
            is_active: true,
            data_source_policy: "manual",
            currency: "PLN",
            counterparty: null,
            counterparty_id: null,
            first_due_date: null,
            recurrence_interval: null,
            recurrence_unit: null,
            active_data_schema_version: null,
          },
        ],
        count: 1,
      })
    return send({ data: [], count: 0 })
  })
  return writes
}
async function selector(page: Page) {
  if (
    (page.viewportSize()?.width ?? 1280) < 768 &&
    !page.url().endsWith("/login")
  )
    await page
      .getByRole("button", { name: /^(More|Więcej)$/ })
      .first()
      .click()
  return page.getByTestId("language-selector").filter({ visible: true })
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)
}

test("login labels, title and existing errors switch without resetting input", async ({
  page,
}) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  await api(page, false)
  await page.goto("/login")
  await page.getByTestId("email-input").fill("user@example.com")
  await page.getByTestId("password-input").fill("short")
  await page.getByTestId("password-input").blur()
  await expect(
    page.getByText("Password must be at least 8 characters", { exact: true }),
  ).toBeVisible()
  await (await selector(page)).selectOption("pl")
  await expect(
    page.getByRole("heading", { name: "Zaloguj się na konto" }),
  ).toBeVisible()
  await expect(
    page.getByText("Hasło musi mieć co najmniej 8 znaków", { exact: true }),
  ).toBeVisible()
  await expect(page).toHaveTitle("Logowanie - Oblidog")
  await expect(page.getByTestId("password-input")).toHaveValue("short")
  await noOverflow(page)
  await (await selector(page)).selectOption("en")
  await expect(page).toHaveTitle("Log In - Oblidog")
  expect(errors).toEqual([])
})
test("category dialog and navigation update without changing user content", async ({
  page,
}, info) => {
  const writes = await api(page, true)
  await page.goto(`/ledgers/${ledgerId}/categories`)
  await (await selector(page)).selectOption("pl")
  await expect(page).toHaveTitle("Kategorie - Oblidog")
  if ((page.viewportSize()?.width ?? 1280) < 768)
    await page
      .getByRole("dialog", { name: "Panel boczny" })
      .getByRole("link", { name: "Kategorie", exact: true })
      .click()
  await expect(page.getByRole("heading", { name: "Home_ledger" })).toBeVisible()
  await expect(page.getByText("Custom_category", { exact: true })).toBeVisible()
  await page
    .getByRole("button", { name: "Nowa kategoria", exact: true })
    .click()
  await expect(
    page
      .getByRole("dialog")
      .getByText("Informacje podstawowe", { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole("dialog").getByText("Tryb kategorii", { exact: true }),
  ).toBeVisible()
  expect(writes).toEqual([{ language: "pl" }])
  await noOverflow(page)
  await info.attach("Polish category dialog", {
    path: await page
      .screenshot({
        path: info.outputPath("polish-dialog.png"),
        animations: "disabled",
      })
      .then(() => info.outputPath("polish-dialog.png")),
    contentType: "image/png",
  })
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Zamknij", exact: true })
    .click()
  await page.goto("/settings")
  await expect(
    page.getByRole("tab", { name: "Mój profil", exact: true }),
  ).toBeVisible()
  await expect(page).toHaveTitle("Ustawienia - Oblidog")
  await noOverflow(page)
})
test("shared demo keeps Polish locally without updating the account", async ({
  page,
}) => {
  const writes = await api(page, true, true)
  await page.goto(`/ledgers/${ledgerId}/categories`)
  await (await selector(page)).selectOption("pl")
  await expect(page.locator("html")).toHaveAttribute("lang", "pl")
  await page.reload()
  await expect(page.locator("html")).toHaveAttribute("lang", "pl")
  expect(writes).toEqual([])
})
