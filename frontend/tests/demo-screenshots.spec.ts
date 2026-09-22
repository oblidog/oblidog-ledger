import { expect, type Page, test } from "@playwright/test"

const referenceDate = new Date("2026-09-07T12:00:00Z")
const demoPassword = "public-demo-password"

const mockDemoConfig = async (page: Page) => {
  await page.route("**/api/v1/utils/public-config", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        environment: "demo",
        is_demo: true,
        demo_credentials: {
          email: "demo@oblidog.com",
          password: demoPassword,
        },
      }),
    }),
  )
}

const setTheme = async (page: Page, theme: "light" | "dark") => {
  await page.evaluate((nextTheme) => {
    localStorage.setItem("vite-ui-theme", nextTheme)
  }, theme)
  await page.reload()
  await expect(page.locator("html")).toHaveClass(new RegExp(theme))
  await expect(page.getByLabel("Lifecycle")).toHaveValue("")
}

test.describe("demo screenshots", () => {
  test.skip(
    process.env.DEMO_SCREENSHOTS !== "true",
    "Run from the manual Demo Screenshots workflow",
  )
  test.use({ storageState: { cookies: [], origins: [] } })

  test("captures the populated demo workspace", async ({ page }) => {
    await page.clock.setFixedTime(referenceDate)
    await page.addInitScript(() => {
      if (!localStorage.getItem("vite-ui-theme")) {
        localStorage.setItem("vite-ui-theme", "light")
      }
    })
    await mockDemoConfig(page)

    await page.goto("/login")
    await expect(page.getByTestId("demo-credentials")).toBeVisible()
    await page.getByRole("button", { name: "Log In" }).click()
    await page.waitForURL(/\/ledgers\/[^/?]+/)

    await expect(page.getByTestId("demo-banner")).toBeVisible()
    await expect(page.getByLabel("Lifecycle")).toHaveValue("")
    await expect(page.getByText(/\bEUR\b/).first()).toBeVisible()

    const logos = page.locator('img[src^="/demo-logos/"]')
    await expect(logos.first()).toBeVisible()
    await expect
      .poll(() =>
        logos.evaluateAll(
          (images) =>
            images.filter(
              (image) =>
                (image as HTMLImageElement).complete &&
                (image as HTMLImageElement).naturalWidth > 0,
            ).length,
        ),
      )
      .toBeGreaterThan(0)

    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.screenshot({
      path: "test-results/demo-screenshots/desktop-light.png",
      animations: "disabled",
      caret: "hide",
    })

    await setTheme(page, "dark")
    await page.screenshot({
      path: "test-results/demo-screenshots/desktop-dark.png",
      animations: "disabled",
      caret: "hide",
    })

    await page.setViewportSize({ width: 390, height: 844 })
    await setTheme(page, "light")
    await page.screenshot({
      path: "test-results/demo-screenshots/mobile-light.png",
      animations: "disabled",
      caret: "hide",
    })
  })
})
