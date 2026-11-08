import { expect, type Page, test } from "@playwright/test"

const screenshotDate = process.env.DEMO_SCREENSHOT_DATE ?? "2026-09-15"
const referenceDate = new Date(`${screenshotDate}T12:00:00Z`)
const demoPassword = "public-demo-password"

const mockDemoConfig = async (page: Page) => {
  await page.route("**/api/v1/utils/public-config", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        environment: "demo",
        is_demo: true,
        demo_writes_enabled: true,
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
    await expect(page.getByTestId("demo-banner")).toBeVisible()
    await page.getByRole("button", { name: "Log In" }).click()
    await page.waitForURL(/\/ledgers\/[^/?]+/)

    await expect(
      page.getByTestId("demo-indicator").filter({ visible: true }),
    ).toBeVisible()
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
      style: '[data-testid="demo-indicator"] { display: none !important; }',
      animations: "disabled",
      caret: "hide",
    })

    await setTheme(page, "dark")
    await page.screenshot({
      path: "test-results/demo-screenshots/desktop-dark.png",
      style: '[data-testid="demo-indicator"] { display: none !important; }',
      animations: "disabled",
      caret: "hide",
    })

    await page.setViewportSize({ width: 390, height: 844 })
    await setTheme(page, "light")
    await page.screenshot({
      path: "test-results/demo-screenshots/mobile-light.png",
      style: '[data-testid="demo-indicator"] { display: none !important; }',
      animations: "disabled",
      caret: "hide",
    })

    await page.emulateMedia({ reducedMotion: "reduce" })
    await page.goto("/")
    const widgets = page.getByTestId("dashboard-payment-widgets")
    await expect(
      widgets.getByRole("region", { name: "Due Calendar" }).getByRole("group"),
    ).toBeVisible()
    await expect(
      widgets
        .getByRole("region", { name: "Payment Forecast" })
        .getByTestId("payment-schedule-chart")
        .first()
        .locator(".recharts-bar-rectangle path")
        .first(),
    ).toBeVisible()
    for (const [size, width, height] of [
      ["desktop", 1440, 1000],
      ["mobile", 390, 844],
    ] as const) {
      await page.setViewportSize({ width, height })
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        )
        .toBe(true)
      for (const chart of await widgets
        .getByTestId("payment-schedule-chart")
        .all()) {
        await expect
          .poll(() =>
            chart.evaluate(
              (element) =>
                element.querySelector("svg.recharts-surface")?.clientWidth ===
                element.clientWidth,
            ),
          )
          .toBe(true)
      }
      await widgets.screenshot({
        path: `test-results/demo-screenshots/dashboard-payments-${size}-light.png`,
        style:
          '[data-slot="sidebar-inset"] > :is(header, nav) { visibility: hidden !important; }',
        animations: "disabled",
        caret: "hide",
      })
    }
  })
})
