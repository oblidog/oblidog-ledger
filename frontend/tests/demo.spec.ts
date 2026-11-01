import { expect, type Page, test } from "@playwright/test"

const demoConfig = {
  environment: "demo",
  is_demo: true,
  demo_writes_enabled: true,
  demo_credentials: {
    email: "demo@oblidog.com",
    password: "public-demo-password",
  },
}

const mockDemoConfig = async (page: Page) => {
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

  test("prefills the public demo credentials", async ({ page }) => {
    await mockDemoConfig(page)
    await page.goto("/login")

    await expect(page.getByTestId("demo-banner")).toBeVisible()
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

test("shows compact demo information and keeps user settings discoverable", async ({
  page,
}) => {
  await mockDemoConfig(page)
  await page.goto("/")
  await expect(page.getByTestId("demo-banner")).toHaveCount(0)
  await page.getByTestId("demo-indicator").filter({ visible: true }).click()
  await expect(page.getByRole("dialog")).toContainText(
    "shared demo environment",
  )
  await page.getByRole("button", { name: "Close", exact: true }).click()
  await page.getByTestId("user-menu").click()
  await expect(
    page.getByRole("menuitem", { name: "User Settings" }),
  ).toBeVisible()
})

test("opens restricted ledger pages as read-only previews", async ({
  page,
}) => {
  await mockDemoConfig(page)
  await page.goto("/")
  await page.getByTestId("ledger-switcher").click()
  await expect(
    page.getByRole("menuitem", { name: "Ledger settings" }),
  ).toBeVisible()
  await expect(page.getByRole("menuitem", { name: "System Run" })).toBeVisible()
  const href = await page
    .getByRole("menuitem", { name: "Ledger settings", exact: true })
    .getAttribute("href")
  const match = href?.match(/^\/ledgers\/([^/]+)\/settings$/)
  expect(match).not.toBeNull()
  const ledgerId = match![1]
  await page.goto(`/ledgers/${ledgerId}/settings`)
  await expect(page).toHaveURL(`/ledgers/${ledgerId}/settings`)
  await expect(page.getByLabel("Name", { exact: true })).toBeDisabled()
  await expect(
    page.getByRole("button", { name: "Save details" }),
  ).toBeDisabled()
  await page.goto(`/ledgers/${ledgerId}/system-run`)
  await expect(page).toHaveURL(`/ledgers/${ledgerId}/system-run`)
  await expect(page.getByTestId("demo-preview-notice")).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Start System Run", exact: true }),
  ).toBeDisabled()
  await expect(
    page.evaluate(() => localStorage.getItem("access_token")),
  ).resolves.toBeNull()
  expect(
    (await page.context().cookies()).some(
      (cookie) => cookie.name === "oblidog_session" && cookie.httpOnly,
    ),
  ).toBeTruthy()
})
