import { expect, test } from "@playwright/test"
import type {
  UserReportPreferences,
  UserReportPreferencesUpdate,
} from "../src/client"
import { firstSuperuser, firstSuperuserPassword } from "./config.ts"
import { createUser } from "./utils/privateApi.ts"
import { randomEmail, randomPassword } from "./utils/random"
import { logInUser, logOutUser } from "./utils/user"

const tabs = ["My profile", "Password", "Reports", "Danger zone"]

test("My profile tab is active by default", async ({ page }) => {
  await page.goto("/settings")
  await expect(page.getByRole("tab", { name: "My profile" })).toHaveAttribute(
    "aria-selected",
    "true",
  )
})

test("All tabs are visible", async ({ page }) => {
  await page.goto("/settings")
  for (const tab of tabs) {
    await expect(page.getByRole("tab", { name: tab })).toBeVisible()
  }
})

test("Report refetch preserves local edits and saves only the changed toggle", async ({
  page,
}) => {
  let preferences: UserReportPreferences = {
    daily_report_enabled: true,
    weekly_report_enabled: true,
  }
  let patch: UserReportPreferencesUpdate | undefined
  await page.route("**/api/v1/users/me/report-preferences", async (route) => {
    if (route.request().method() === "PATCH") {
      patch = route.request().postDataJSON() as UserReportPreferencesUpdate
      preferences = { ...preferences, ...patch }
    }
    await route.fulfill({ json: preferences })
  })
  await page.goto("/settings")
  await page.getByRole("tab", { name: "Reports", exact: true }).click()
  const daily = page.getByRole("checkbox", {
    name: "Daily report",
    exact: true,
  })
  const weekly = page.getByRole("checkbox", {
    name: "Weekly report",
    exact: true,
  })
  const save = page.getByRole("button", { name: "Save", exact: true })
  await expect(daily).toBeChecked()
  await expect(weekly).toBeChecked()

  const refetch = async () => {
    await page.bringToFront()
    const response = page.waitForResponse(
      (response) =>
        response.url().endsWith("/users/me/report-preferences") &&
        response.request().method() === "GET",
    )
    await page.evaluate(() =>
      window.dispatchEvent(new Event("visibilitychange")),
    )
    await response
  }

  // A change from another session updates a clean form.
  preferences.weekly_report_enabled = false
  await refetch()
  await expect(weekly).not.toBeChecked()
  await expect(save).toBeDisabled()

  // Refetching must keep the local edit while accepting the other server value.
  await daily.uncheck()
  preferences.weekly_report_enabled = true
  await refetch()
  await expect(daily).not.toBeChecked()
  await expect(weekly).toBeChecked()

  // Even a server change after the last refetch must survive a partial save.
  preferences.weekly_report_enabled = false
  await save.click()
  await expect(page.getByText("Report preferences saved")).toBeVisible()
  expect(patch).toEqual({ daily_report_enabled: false })
  await expect(daily).not.toBeChecked()
  await expect(weekly).not.toBeChecked()
  await expect(save).toBeDisabled()
})

test.describe("Report preferences", () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test("Report toggles save independently and survive reload", async ({
    page,
  }) => {
    const email = randomEmail()
    const password = randomPassword()
    await createUser({ email, password })
    await logInUser(page, email, password)
    await page.goto("/settings")
    await page.getByRole("tab", { name: "Reports", exact: true }).click()

    const daily = page.getByRole("checkbox", {
      name: "Daily report",
      exact: true,
    })
    const weekly = page.getByRole("checkbox", {
      name: "Weekly report",
      exact: true,
    })
    const save = page.getByRole("button", { name: "Save", exact: true })
    await expect(daily).toBeChecked()
    await expect(weekly).toBeChecked()
    await expect(save).toBeDisabled()

    await daily.uncheck()
    await save.click()
    await expect(page.getByText("Report preferences saved")).toBeVisible()
    await expect(save).toBeDisabled()
    await page.reload()
    await page.getByRole("tab", { name: "Reports", exact: true }).click()
    await expect(daily).not.toBeChecked()
    await expect(weekly).toBeChecked()

    await weekly.uncheck()
    await save.click()
    await expect(save).toBeDisabled()
    await page.reload()
    await page.getByRole("tab", { name: "Reports", exact: true }).click()
    await expect(daily).not.toBeChecked()
    await expect(weekly).not.toBeChecked()

    await daily.check()
    await save.click()
    await expect(save).toBeDisabled()
    await page.reload()
    await page.getByRole("tab", { name: "Reports", exact: true }).click()
    await expect(daily).toBeChecked()
    await expect(weekly).not.toBeChecked()
  })
})

test.describe("Edit user profile", () => {
  test.use({ storageState: { cookies: [], origins: [] } })
  let email: string
  let password: string

  test.beforeAll(async () => {
    email = randomEmail()
    password = randomPassword()
    await createUser({ email, password })
  })

  test.beforeEach(async ({ page }) => {
    await logInUser(page, email, password)
    await page.goto("/settings")
    await page.getByRole("tab", { name: "My profile" }).click()
  })

  test("Edit user name with a valid name", async ({ page }) => {
    const updatedName = "Test User 2"

    await page.getByRole("button", { name: "Edit" }).click()
    await page.getByLabel("Full name").fill(updatedName)
    await page.getByRole("button", { name: "Save" }).click()

    await expect(page.getByText("User updated successfully")).toBeVisible()
    await expect(
      page.locator("form").getByText(updatedName, { exact: true }),
    ).toBeVisible()
  })

  test("Edit user email with an invalid email shows error", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Edit" }).click()
    await page.getByLabel("Email").fill("")
    await page.locator("body").click()

    await expect(page.getByText("Invalid email address")).toBeVisible()
  })
})

test.describe("Edit user email", () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test("Edit user email with a valid email", async ({ page }) => {
    const email = randomEmail()
    const password = randomPassword()
    const updatedEmail = randomEmail()

    await createUser({ email, password })
    await logInUser(page, email, password)
    await page.goto("/settings")
    await page.getByRole("tab", { name: "My profile" }).click()

    await page.getByRole("button", { name: "Edit" }).click()
    await page.getByLabel("Email").fill(updatedEmail)
    await page.getByRole("button", { name: "Save" }).click()

    await expect(page.getByText("User updated successfully")).toBeVisible()
    await expect(
      page.locator("form").getByText(updatedEmail, { exact: true }),
    ).toBeVisible()
  })
})

test.describe("Cancel edit actions", () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test("Cancel edit action restores original name", async ({ page }) => {
    const email = randomEmail()
    const password = randomPassword()
    const user = await createUser({ email, password })

    await logInUser(page, email, password)
    await page.goto("/settings")
    await page.getByRole("tab", { name: "My profile" }).click()
    await page.getByRole("button", { name: "Edit" }).click()
    await page.getByLabel("Full name").fill("Test User")
    await page.getByRole("button", { name: "Cancel" }).first().click()

    await expect(
      page.locator("form").getByText(user.full_name as string, { exact: true }),
    ).toBeVisible()
  })

  test("Cancel edit action restores original email", async ({ page }) => {
    const email = randomEmail()
    const password = randomPassword()
    await createUser({ email, password })

    await logInUser(page, email, password)
    await page.goto("/settings")
    await page.getByRole("tab", { name: "My profile" }).click()
    await page.getByRole("button", { name: "Edit" }).click()
    await page.getByLabel("Email").fill(randomEmail())
    await page.getByRole("button", { name: "Cancel" }).first().click()

    await expect(
      page.locator("form").getByText(email, { exact: true }),
    ).toBeVisible()
  })
})

test.describe("Change password", () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test("Update password successfully", async ({ page }) => {
    const email = randomEmail()
    const password = randomPassword()
    const newPassword = randomPassword()

    await createUser({ email, password })
    await logInUser(page, email, password)

    await page.goto("/settings")
    await page.getByRole("tab", { name: "Password" }).click()
    await page.getByTestId("current-password-input").fill(password)
    await page.getByTestId("new-password-input").fill(newPassword)
    await page.getByTestId("confirm-password-input").fill(newPassword)
    await page.getByRole("button", { name: "Update Password" }).click()

    await expect(page).toHaveURL(/\/login\?passwordChanged=true$/)
    await expect(page.getByTestId("password-changed-message")).toContainText(
      "Your sessions were signed out",
    )
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("access_token")))
      .toBeNull()

    await logInUser(page, email, newPassword)
  })
})

test.describe("Change password validation", () => {
  test.use({ storageState: { cookies: [], origins: [] } })
  let email: string
  let password: string

  test.beforeAll(async () => {
    email = randomEmail()
    password = randomPassword()
    await createUser({ email, password })
  })

  test.beforeEach(async ({ page }) => {
    await logInUser(page, email, password)
    await page.goto("/settings")
    await page.getByRole("tab", { name: "Password" }).click()
  })

  test("Update password with weak passwords", async ({ page }) => {
    const weakPassword = "weak"

    await page.getByTestId("current-password-input").fill(password)
    await page.getByTestId("new-password-input").fill(weakPassword)
    await page.getByTestId("confirm-password-input").fill(weakPassword)
    await page.getByRole("button", { name: "Update Password" }).click()

    await expect(
      page.getByText("Password must be at least 8 characters"),
    ).toBeVisible()
  })

  test("New password and confirmation password do not match", async ({
    page,
  }) => {
    await page.getByTestId("current-password-input").fill(password)
    await page.getByTestId("new-password-input").fill(randomPassword())
    await page.getByTestId("confirm-password-input").fill(randomPassword())
    await page.getByRole("button", { name: "Update Password" }).click()

    await expect(page.getByText("The passwords don't match")).toBeVisible()
  })

  test("Current password and new password are the same", async ({ page }) => {
    await page.getByTestId("current-password-input").fill(password)
    await page.getByTestId("new-password-input").fill(password)
    await page.getByTestId("confirm-password-input").fill(password)
    await page.getByRole("button", { name: "Update Password" }).click()

    await expect(
      page.getByText("New password cannot be the same as the current one"),
    ).toBeVisible()
  })
})

test("Appearance button is visible in sidebar", async ({ page }) => {
  await page.goto("/settings")
  await expect(page.getByTestId("theme-button")).toBeVisible()
})

test("User can switch between theme modes", async ({ page }) => {
  await page.goto("/settings")

  await page.getByTestId("theme-button").click()
  await page.getByTestId("dark-mode").click()
  await expect(page.locator("html")).toHaveClass(/dark/)

  await expect(page.getByTestId("dark-mode")).not.toBeVisible()

  await page.getByTestId("theme-button").click()
  await page.getByTestId("light-mode").click()
  await expect(page.locator("html")).toHaveClass(/light/)
})

test("Selected mode is preserved across sessions", async ({ page }) => {
  await page.goto("/settings")

  await page.evaluate(() => localStorage.setItem("vite-ui-theme", "dark"))
  await page.reload()
  await expect(page.locator("html")).toHaveClass(/dark/)

  await logOutUser(page)
  await logInUser(page, firstSuperuser, firstSuperuserPassword)

  await expect(page.locator("html")).toHaveClass(/dark/)
})
