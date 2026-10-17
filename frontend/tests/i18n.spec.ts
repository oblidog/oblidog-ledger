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

test("visible JSON errors follow the language without losing the draft", async ({
  page,
}) => {
  await api(page, true)
  await page.route("**/data-schema", (route) =>
    route.fulfill({ status: 404, json: { detail: "Not found" } }),
  )
  await page.goto(`/ledgers/${ledgerId}/categories/category/custom-fields`)
  await page.getByRole("button", { name: "Edit JSON", exact: true }).click()
  const editor = page.locator("#category-data-schema-json")
  await editor.fill("{invalid")
  await page.getByRole("button", { name: "Apply JSON", exact: true }).click()
  await expect(
    page.getByText("Enter valid JSON before saving.", { exact: true }),
  ).toBeVisible()
  await (await selector(page)).selectOption("pl")
  await expect(
    page.getByText("Wprowadź poprawny JSON przed zapisaniem.", { exact: true }),
  ).toBeAttached()
  await expect(editor).toHaveValue("{invalid")
  await page
    .getByTestId("language-selector")
    .filter({ visible: true })
    .selectOption("en")
  await expect(
    page.getByText("Enter valid JSON before saving.", { exact: true }),
  ).toBeAttached()
})

test("API errors use stable codes in Polish and hide unknown diagnostics", async ({
  page,
}) => {
  await api(page, false)
  let payload = {
    code: "auth_invalid_credentials",
    detail: "operator-only diagnostic",
    params: {},
  }
  await page.route("**/login/session", (route) =>
    route.fulfill({ status: 400, json: payload }),
  )
  await page.goto("/login")
  await (await selector(page)).selectOption("pl")
  await page.getByTestId("email-input").fill("user@example.com")
  await page.getByTestId("password-input").fill("valid-password")
  await page.getByRole("button", { name: "Zaloguj się", exact: true }).click()
  await expect(
    page.getByText("Nieprawidłowy e-mail lub hasło", { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByText("operator-only diagnostic", { exact: true }),
  ).toHaveCount(0)
  payload = { ...payload, code: "future_unknown_error" }
  await page.getByRole("button", { name: "Zaloguj się", exact: true }).click()
  await expect(
    page.getByText("Nie udało się wykonać operacji. Spróbuj ponownie.", {
      exact: true,
    }),
  ).toBeVisible()
  await expect(
    page.getByText("operator-only diagnostic", { exact: true }),
  ).toHaveCount(0)
})

test("failed logout hides diagnostics and preserves the signed-in session", async ({
  page,
}) => {
  await api(page, true)
  await page.route("**/api/v1/login/logout", (route) =>
    route.fulfill({
      status: 500,
      json: { detail: "operator-only logout diagnostic" },
    }),
  )
  await page.goto(`/ledgers/${ledgerId}/categories`)
  if ((page.viewportSize()?.width ?? 1280) < 768)
    await page.getByLabel("More", { exact: true }).click()
  await page.getByTestId("user-menu").filter({ visible: true }).click()
  await page.getByRole("menuitem", { name: "Log Out", exact: true }).click()
  await expect(
    page.getByText("Could not complete this action. Try again.", {
      exact: true,
    }),
  ).toBeVisible()
  await expect(
    page.getByText("operator-only logout diagnostic", { exact: true }),
  ).toHaveCount(0)
  await expect(page).not.toHaveURL(/\/login/)
  await expect(
    page.getByTestId("user-menu").filter({ visible: true }),
  ).toBeVisible()
})

test("German login translates validation and survives reload", async ({
  page,
}) => {
  await api(page, false)
  await page.goto("/login")
  await page.getByTestId("password-input").fill("short")
  await page.getByTestId("password-input").blur()
  await (await selector(page)).selectOption("de")
  await expect(page).toHaveTitle("Anmelden - Oblidog")
  await expect(page.locator("html")).toHaveAttribute("lang", "de")
  await expect(
    page.getByText("Das Passwort muss mindestens 8 Zeichen lang sein", {
      exact: true,
    }),
  ).toBeVisible()
  await expect(page.getByTestId("password-input")).toHaveValue("short")
  await noOverflow(page)
  await page.reload()
  await expect(page).toHaveTitle("Anmelden - Oblidog")
  await expect(page.getByTestId("language-selector")).toHaveValue("de")
})

test("German account choice persists and preserves category content", async ({
  page,
}) => {
  const writes = await api(page, true)
  await page.goto(`/ledgers/${ledgerId}/categories`)
  await (await selector(page)).selectOption("de")
  await expect(page).toHaveTitle("Kategorien - Oblidog")
  expect(writes).toEqual([{ language: "de" }])
  if ((page.viewportSize()?.width ?? 1280) < 768) {
    await page
      .getByRole("dialog", { name: "Seitenleiste" })
      .getByRole("link", { name: "Kategorien", exact: true })
      .click()
  }
  await expect(page.getByText("Custom_category", { exact: true })).toBeVisible()
  await page
    .getByRole("button", { name: "Neue Kategorie", exact: true })
    .click()
  await expect(page.getByRole("dialog")).toBeVisible()
  await expect(
    page
      .getByRole("dialog")
      .getByText(
        "Zahlungsverpflichtungen folgen dem Zahlungsplan und können auch manuell erstellt werden.",
      ),
  ).toBeVisible()
  await noOverflow(page)
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Schließen", exact: true })
    .click()
  await page.reload()
  await expect(page).toHaveTitle("Kategorien - Oblidog")
})
