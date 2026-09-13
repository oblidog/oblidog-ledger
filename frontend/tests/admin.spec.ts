import { expect, test } from "@playwright/test"
import { firstSuperuser, firstSuperuserPassword } from "./config.ts"
import { createUser } from "./utils/privateApi"
import { randomEmail, randomPassword } from "./utils/random"
import { logInUser } from "./utils/user"

test("Admin page separates invitations from user accounts", async ({
  page,
}) => {
  await page.goto("/admin")

  await expect(page.getByRole("heading", { name: "Users" })).toBeVisible()
  await expect(
    page.getByText("Manage user accounts, permissions, and invitations"),
  ).toBeVisible()
  await expect(page.getByRole("heading", { name: "Invitations" })).toBeVisible()
  await expect(
    page.getByRole("heading", { name: "User accounts" }),
  ).toBeVisible()
})

test.describe("Admin invitation management", () => {
  test("Invitation form does not ask the admin for a password", async ({
    page,
  }) => {
    await page.goto("/admin")
    await page.getByRole("button", { name: "Invite User" }).click()

    const dialog = page.getByRole("dialog")
    await expect(dialog.getByLabel("Email *")).toBeVisible()
    await expect(dialog.getByLabel("Full Name")).toBeVisible()
    await expect(dialog.getByLabel("Is superuser?")).toBeVisible()
    await expect(dialog.locator('input[type="password"]')).toHaveCount(0)
    await expect(dialog.getByLabel(/active/i)).toHaveCount(0)
  })

  test("Admin can send an invitation", async ({ page }) => {
    const email = randomEmail()
    const fullName = "Invited Test User"

    await page.goto("/admin")
    await page.getByRole("button", { name: "Invite User" }).click()
    await page.getByPlaceholder("Email").fill(email)
    await page.getByPlaceholder("Full name").fill(fullName)
    await page.getByRole("button", { name: "Send invitation" }).click()

    await expect(page.getByText("Invitation sent")).toBeVisible()
    await expect(page.getByRole("dialog")).not.toBeVisible()

    const row = page.getByRole("row").filter({ hasText: email })
    await expect(row).toBeVisible()
    await expect(row.getByText(fullName)).toBeVisible()
    await expect(row.getByText("Pending")).toBeVisible()
  })

  test("Admin can invite a superuser", async ({ page }) => {
    const email = randomEmail()

    await page.goto("/admin")
    await page.getByRole("button", { name: "Invite User" }).click()
    await page.getByPlaceholder("Email").fill(email)
    await page.getByLabel("Is superuser?").check()
    await page.getByRole("button", { name: "Send invitation" }).click()

    const row = page.getByRole("row").filter({ hasText: email })
    await expect(row.getByText("Superuser")).toBeVisible()
  })

  test("Admin can resend an invitation", async ({ page }) => {
    const email = randomEmail()

    await page.goto("/admin")
    await page.getByRole("button", { name: "Invite User" }).click()
    await page.getByPlaceholder("Email").fill(email)
    await page.getByRole("button", { name: "Send invitation" }).click()

    const row = page.getByRole("row").filter({ hasText: email })
    await row
      .getByRole("button", { name: `Resend invitation to ${email}` })
      .click()
    await expect(page.getByText("Invitation resent")).toBeVisible()
    await expect(row.getByText("Pending")).toBeVisible()
  })

  test("Admin can revoke an invitation", async ({ page }) => {
    const email = randomEmail()

    await page.goto("/admin")
    await page.getByRole("button", { name: "Invite User" }).click()
    await page.getByPlaceholder("Email").fill(email)
    await page.getByRole("button", { name: "Send invitation" }).click()

    const row = page.getByRole("row").filter({ hasText: email })
    await row
      .getByRole("button", { name: `Revoke invitation for ${email}` })
      .click()
    await page
      .getByRole("button", { name: "Revoke invitation", exact: true })
      .click()

    await expect(page.getByText("Invitation revoked")).toBeVisible()
    await expect(row.getByText("Revoked")).toBeVisible()
  })

  test("Duplicate invitation error is shown", async ({ page }) => {
    const email = randomEmail()

    await page.goto("/admin")
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await page.getByRole("button", { name: "Invite User" }).click()
      await page.getByPlaceholder("Email").fill(email)
      await page.getByRole("button", { name: "Send invitation" }).click()
      if (attempt === 0) {
        await expect(page.getByText("Invitation sent")).toBeVisible()
        await expect(page.getByRole("dialog")).not.toBeVisible()
      }
    }

    await expect(
      page.getByText("An active invitation for this email already exists"),
    ).toBeVisible()
  })

  test("Invitation email must be valid", async ({ page }) => {
    await page.goto("/admin")
    await page.getByRole("button", { name: "Invite User" }).click()
    await page.getByPlaceholder("Email").fill("invalid-email")
    await page.getByPlaceholder("Email").blur()

    await expect(page.getByText("Invalid email address")).toBeVisible()
  })

  test("Invitation dialog can be cancelled", async ({ page }) => {
    await page.goto("/admin")
    await page.getByRole("button", { name: "Invite User" }).click()
    await page.getByPlaceholder("Email").fill(randomEmail())
    await page.getByRole("button", { name: "Cancel" }).click()

    await expect(page.getByRole("dialog")).not.toBeVisible()
  })
})

test.describe("Existing user management", () => {
  test("Admin can edit an existing user", async ({ page }) => {
    const email = randomEmail()
    const password = randomPassword()
    const user = await createUser({ email, password })

    await page.goto("/admin")
    const row = page.getByRole("row").filter({ hasText: user.email })
    await row.getByRole("button").click()
    await page.getByRole("menuitem", { name: "Edit User" }).click()
    await page.getByPlaceholder("Full name").fill("Updated User")
    await page.getByRole("button", { name: "Save" }).click()

    await expect(page.getByText("User updated successfully")).toBeVisible()
    await expect(row.getByText("Updated User")).toBeVisible()
  })

  test("Admin can delete an existing user", async ({ page }) => {
    const email = randomEmail()
    const password = randomPassword()
    await createUser({ email, password })

    await page.goto("/admin")
    const row = page.getByRole("row").filter({ hasText: email })
    await row.getByRole("button").click()
    await page.getByRole("menuitem", { name: "Delete User" }).click()
    await page.getByRole("button", { name: "Delete" }).click()

    await expect(
      page.getByText("The user was deleted successfully"),
    ).toBeVisible()
    await expect(row).not.toBeVisible()
  })
})

test.describe("Admin page access control", () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test("Non-superuser cannot access admin page", async ({ page }) => {
    const email = randomEmail()
    const password = randomPassword()

    await createUser({ email, password })
    await logInUser(page, email, password)
    await page.goto("/admin")

    await expect(page.getByRole("heading", { name: "Users" })).not.toBeVisible()
    await expect(page).not.toHaveURL(/\/admin/)
  })

  test("Superuser can access admin page", async ({ page }) => {
    await logInUser(page, firstSuperuser, firstSuperuserPassword)
    await page.goto("/admin")

    await expect(page.getByRole("heading", { name: "Users" })).toBeVisible()
  })
})
