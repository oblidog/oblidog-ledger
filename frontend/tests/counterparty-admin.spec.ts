import { expect, test } from "@playwright/test"
import { createUser } from "./utils/privateApi"
import { randomEmail, randomPassword } from "./utils/random"
import { logInUser } from "./utils/user"

function uniqueName(prefix: string) {
  return `${prefix} ${Math.random().toString(36).slice(2, 8)}`
}

test("superuser can create, edit, search and delete counterparties", async ({
  page,
}) => {
  const name = uniqueName("Counterparty")
  const updatedName = `${name} updated`

  await page.goto("/counterparties")
  await expect(
    page.getByRole("heading", { name: "Counterparties" }),
  ).toBeVisible()

  await page.getByRole("button", { name: "Add counterparty" }).click()
  const createDialog = page.getByRole("dialog")
  await createDialog.getByLabel("Name *").fill(name)
  await createDialog.getByLabel("Short name").fill("CP Test")
  await createDialog
    .getByLabel("Website URL")
    .fill("https://example.com/counterparty")
  await createDialog
    .getByRole("button", { name: "Create counterparty" })
    .click()
  await expect(createDialog).toBeHidden()
  await expect(page.getByText(name, { exact: true })).toBeVisible()

  await page.getByLabel("Search counterparties").fill(name)
  await expect(page.getByText(name, { exact: true })).toBeVisible()

  await page.getByRole("button", { name: `Edit ${name}` }).click()
  const editDialog = page.getByRole("dialog")
  await editDialog.getByLabel("Name *").fill(updatedName)
  await editDialog.getByLabel("Logo URL").fill("https://example.com/logo.svg")
  await editDialog.getByRole("button", { name: "Save changes" }).click()
  await expect(editDialog).toBeHidden()

  await page.getByLabel("Search counterparties").fill(updatedName)
  await expect(page.getByText(updatedName, { exact: true })).toBeVisible()

  await page
    .getByRole("button", { name: `Delete ${updatedName}` })
    .click()
  const deleteDialog = page.getByRole("dialog")
  await deleteDialog.getByRole("button", { name: "Delete" }).click()
  await expect(deleteDialog).toBeHidden()
  await expect(page.getByText(updatedName, { exact: true })).not.toBeVisible()
})

test.describe("Counterparty catalog access control", () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test("non-superuser cannot see or access counterparty catalog", async ({ page }) => {
    const email = randomEmail()
    const password = randomPassword()

    await createUser({ email, password })
    await logInUser(page, email, password)

    await expect(
      page.locator('[data-sidebar="sidebar"]').getByRole("link", {
        name: "Counterparties",
      }),
    ).not.toBeVisible()

    await page.goto("/counterparties")
    await expect(
      page.getByRole("heading", { name: "Counterparties" }),
    ).not.toBeVisible()
    await expect(page).not.toHaveURL(/\/counterparties/)
  })
})
