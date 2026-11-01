import { expect, type Page, test } from "@playwright/test"
import de from "../src/i18n/locales/de/app/auth.json" with { type: "json" }
import en from "../src/i18n/locales/en/app/auth.json" with { type: "json" }
import pl from "../src/i18n/locales/pl/app/auth.json" with { type: "json" }

const credentials = {
  email: "demo@oblidog.com",
  password: "public-demo-password",
}

test.use({ storageState: { cookies: [], origins: [] } })

async function mockLogin(page: Page, demo = true, readOnly = false) {
  await page.route("**/api/v1/**", (route) => {
    if (
      new URL(route.request().url()).pathname.endsWith("/utils/public-config")
    ) {
      return route.fulfill({
        json: {
          environment: demo ? "demo" : "local",
          is_demo: demo,
          demo_writes_enabled: !readOnly,
          demo_credentials: demo ? credentials : null,
        },
      })
    }
    return route.fulfill({ status: 401, json: { detail: "Not authenticated" } })
  })
}

for (const [language, copy] of Object.entries({ en, pl, de })) {
  for (const theme of ["light", "dark"]) {
    test(`${language} ${theme}: compact notice, prefill and keyboard entry`, async ({
      page,
    }) => {
      await page.addInitScript(
        ({ language, theme }) => {
          localStorage.setItem("oblidog-language", language)
          localStorage.setItem("vite-ui-theme", theme)
        },
        { language, theme },
      )
      await mockLogin(page)
      await page.goto("/login")
      const banner = page.getByTestId("demo-banner")
      await expect(banner).toContainText(copy.demo_shared_account_notice)
      await expect(page.getByRole("alert")).toHaveCount(1)
      await expect(banner).not.toContainText(credentials.email)
      await expect(banner).not.toContainText(credentials.password)
      await expect(page.locator("form > div").first().locator("p")).toHaveCount(
        0,
      )
      await expect(page.getByTestId("email-input")).toHaveValue(
        credentials.email,
      )
      const password = page.getByTestId("password-input")
      await expect(password).toHaveValue(credentials.password)
      await expect(password).toHaveAttribute("type", "password")
      await password.focus()
      await page.keyboard.press("Tab")
      const toggle = page.locator("form button[type=button]")
      await expect(toggle).toBeFocused()
      await page.keyboard.press("Enter")
      await expect(password).toHaveAttribute("type", "text")
      await page.keyboard.press("Tab")
      const submit = page.getByRole("button", {
        name: copy.enter_demo,
        exact: true,
      })
      await expect(submit).toBeFocused()
      await expect(submit).toBeInViewport()
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true)
      await expect(page.locator("html")).toHaveClass(new RegExp(theme))
      await page.screenshot({
        path: test.info().outputPath("login.png"),
        fullPage: true,
      })
      // Use the existing session endpoint, including its loading/error path.
      let finishLogin!: () => void
      const pending = new Promise<void>((resolve) => {
        finishLogin = resolve
      })
      await page.route("**/api/v1/login/session", async (route) => {
        const body = new URLSearchParams(route.request().postData() ?? "")
        expect(body.get("username")).toBe(credentials.email)
        expect(body.get("password")).toBe(credentials.password)
        await pending
        await route.fulfill({
          status: 400,
          json: {
            code: "auth_invalid_credentials",
            detail: "Incorrect email or password",
          },
        })
      })
      await page.keyboard.press("Enter")
      await expect(submit).toBeDisabled()
      finishLogin()
      await expect(submit).toBeEnabled()
      await expect(
        page.getByText(
          {
            en: "Incorrect email or password",
            pl: "Nieprawidłowy e-mail lub hasło",
            de: "Falsche E-Mail-Adresse oder falsches Passwort",
          }[language]!,
          { exact: true },
        ),
      ).toBeVisible()
      await expect(page).toHaveURL(/\/login$/)
    })
  }
}

test("ordinary login keeps its copy and empty fields", async ({ page }) => {
  await mockLogin(page, false)
  await page.goto("/login")
  await expect(page.getByTestId("demo-banner")).toHaveCount(0)
  await expect(
    page.getByText(en.access_is_limited_to_users_invited_by_an_administrator),
  ).toBeVisible()
  await expect(
    page.getByRole("link", { name: en.forgot_your_password }),
  ).toBeVisible()
  await expect(page.getByTestId("email-input")).toBeEmpty()
  await expect(page.getByTestId("password-input")).toBeEmpty()
  await expect(
    page.getByRole("button", { name: en.log_in, exact: true }),
  ).toBeVisible()
})

test("read-only demo keeps its explicit notice", async ({ page }) => {
  await mockLogin(page, true, true)
  await page.goto("/login")
  await expect(page.getByRole("alert")).toHaveCount(1)
  await expect(page.getByTestId("demo-banner")).toContainText("read-only")
  await expect(
    page.getByRole("button", { name: en.enter_demo, exact: true }),
  ).toBeVisible()
})
