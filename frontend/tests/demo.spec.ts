import { expect, test } from "@playwright/test"

const demoConfig = {
  environment: "demo",
  is_demo: true,
  demo_credentials: {
    email: "demo@oblidog.com",
    password: "public-demo-password",
  },
}

const mockDemoConfig = async (page: Parameters<typeof test>[0]["page"]) => {
  await page.route("**/api/v1/utils/public-config", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(demoConfig),
    }),
  )
}

test.describe("demo login", () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test("shows and prefills the public demo credentials", async ({ page }) => {
    await mockDemoConfig(page)
    await page.goto("/login")

    await expect(page.getByTestId("demo-credentials")).toBeVisible()
    await expect(page.getByTestId("email-input")).toHaveValue(
      demoConfig.demo_credentials.email,
    )
    await expect(page.getByTestId("password-input")).toHaveValue(
      demoConfig.demo_credentials.password,
    )
    await expect(
      page.getByRole("link", { name: "Forgot your password?" }),
    ).toHaveCount(0)
  })
})

test("shows the persistent demo banner and hides user settings", async ({ page }) => {
  await mockDemoConfig(page)
  await page.goto("/")

  await expect(page.getByTestId("demo-banner")).toBeVisible()
  await page.getByTestId("user-menu").click()
  await expect(page.getByRole("menuitem", { name: "User Settings" })).toHaveCount(0)
})
