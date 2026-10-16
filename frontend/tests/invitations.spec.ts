import { expect, test } from "@playwright/test"
import { applicationLink, waitForEmail } from "./utils/mailpit"
import { randomEmail, randomPassword } from "./utils/random"
import { logInUser } from "./utils/user"

test("Admin invitation can be accepted and the recipient can sign in", async ({
  page,
  baseURL,
}) => {
  const email = randomEmail()
  const password = randomPassword()

  await page.goto("/admin")
  await page.getByRole("button", { name: "Invite User" }).click()
  await page.getByPlaceholder("Email").fill(email)
  await page.getByPlaceholder("Full name").fill("Invitation Recipient")
  await page.getByRole("button", { name: "Send invitation" }).click()
  await expect(page.getByText("Invitation sent")).toBeVisible()

  const message = await waitForEmail({
    recipient: email,
    subject: "You're invited",
  })
  const invitationUrl = applicationLink(
    message.HTML,
    "/accept-invitation",
    baseURL!,
  )

  await page.context().clearCookies()
  await page.goto(invitationUrl)

  await expect(
    page.getByRole("heading", { name: "Create your account" }),
  ).toBeVisible()
  await expect(page.getByTestId("invited-email")).toHaveValue(email)
  await expect(page.getByTestId("invited-email")).not.toBeEditable()

  await page.getByTestId("new-password-input").fill("short")
  await page.getByTestId("confirm-password-input").fill("different")
  await page.getByRole("button", { name: "Create account" }).click()
  await expect(
    page.getByText("Password must be at least 8 characters"),
  ).toBeVisible()
  await expect(page.getByText("The passwords don't match")).toBeVisible()

  await page.getByTestId("new-password-input").fill(password)
  await page.getByTestId("confirm-password-input").fill(password)
  await page.getByRole("button", { name: "Create account" }).click()

  await expect(
    page.getByRole("heading", { name: "Account created" }),
  ).toBeVisible()
  await page.getByRole("link", { name: "Go to login" }).click()
  await logInUser(page, email, password)

  await page.context().clearCookies()
  await page.goto(invitationUrl)
  await expect(
    page.getByText("This invitation has already been used"),
  ).toBeVisible()
})

test("Invalid invitation has a terminal state", async ({ page }) => {
  await page.goto("/accept-invitation?token=invalid-token")

  await expect(
    page.getByRole("heading", { name: "Invitation unavailable" }),
  ).toBeVisible()
  await expect(page.getByText("This invitation link is invalid.")).toBeVisible()
})

test("Missing invitation token has a terminal state", async ({ page }) => {
  await page.goto("/accept-invitation")

  await expect(
    page.getByText("This invitation link is missing its token."),
  ).toBeVisible()
})

test("Expired invitation explains how to recover", async ({ page }) => {
  await page.route("**/api/v1/invitations/**", async (route) => {
    await route.fulfill({
      status: 410,
      contentType: "application/json",
      body: JSON.stringify({
        detail: "Invitation has expired",
        code: "invitation_expired",
        params: {},
      }),
    })
  })

  await page.goto("/accept-invitation?token=expired-token")

  await expect(
    page.getByText(
      "This invitation has expired. Ask an administrator to resend it.",
    ),
  ).toBeVisible()
})
