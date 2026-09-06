import { expect, type Page, test } from "@playwright/test"

function uniqueName(prefix: string) {
  return `${prefix} ${Math.random().toString(36).slice(2, 8)}`
}

async function openCategoryAction(
  page: Page,
  categoryName: string,
  action: string,
) {
  await page
    .getByRole("button", { name: `More actions for ${categoryName}` })
    .click()
  await page.getByRole("menuitem", { name: action }).click()
}

async function openCategories(page: Page) {
  await page
    .locator('[data-sidebar="sidebar"]')
    .getByRole("link", { name: "Categories" })
    .click()
}

test("manages category custom fields with the builder", async ({ page }) => {
  const ledgerName = uniqueName("Custom fields")
  const groupName = uniqueName("Utilities")
  const categoryName = uniqueName("Electricity")

  await page.goto("/ledgers")
  await page.getByRole("button", { name: "New ledger" }).click()
  await page.getByLabel("Name").fill(ledgerName)
  await page.getByRole("button", { name: "Create ledger" }).click()
  await expect(page.getByText("Ledger created successfully")).toBeVisible()
  await page.getByRole("link", { name: ledgerName }).click()

  await openCategories(page)
  await page.getByRole("button", { name: "New group" }).click()
  await page.getByLabel("Name").fill(groupName)
  await page.getByRole("button", { name: "Create group" }).click()
  await expect(page.getByText("Category group created")).toBeVisible()

  await page.getByRole("button", { name: "New category" }).click()
  await page.getByLabel("Group").click()
  await page.getByRole("option", { name: groupName }).click()
  await page.getByLabel("Name").fill(categoryName)
  await page.getByLabel("Code").fill("ELEC")
  const createCategoryButton = page.getByRole("button", {
    name: "Create category",
  })
  await createCategoryButton.scrollIntoViewIfNeeded()
  await createCategoryButton.click()
  await expect(page.getByText("Category created")).toBeVisible()

  await openCategoryAction(page, categoryName, "Manage custom fields")
  await expect(page).toHaveURL(/\/custom-fields$/)
  await page.getByRole("button", { name: "Add field" }).click()
  await page.getByLabel("Field name").fill("meter_reading_kwh")
  await page.getByLabel("Label").fill("Meter reading")
  page.once("dialog", (dialog) => dialog.accept())
  await page.reload()
  await expect(page.getByLabel("Field name")).toHaveValue("meter_reading_kwh")
  await expect(page.getByLabel("Label")).toHaveValue("Meter reading")
  const saveCustomFieldsButton = page.getByRole("button", {
    name: "Save custom fields",
  })
  await saveCustomFieldsButton.scrollIntoViewIfNeeded()
  await saveCustomFieldsButton.click()
  await expect(
    page.getByText("Custom fields saved as schema version 1"),
  ).toBeVisible()

  await page.getByRole("link", { name: "Back to categories" }).click()
  await openCategoryAction(page, categoryName, "Manage custom fields")
  await expect(page.getByLabel("Field name")).toHaveValue("meter_reading_kwh")
  await page.getByLabel("Type").click()
  await page.getByRole("option", { name: "Number" }).click()
  page.once("dialog", (dialog) => dialog.accept())
  await page.reload()
  await expect(page.getByLabel("Type")).toHaveText("Number")
  await page.getByLabel("Field name").fill("current_reading_kwh")
  await page.getByRole("link", { name: "Back to categories" }).click()
  await expect(
    page.getByRole("heading", { name: "Leave without saving?" }),
  ).toBeVisible()
  await page.getByRole("button", { name: "Stay on this page" }).click()
  await page.getByRole("button", { name: "Discard changes" }).click()
  const discardDialog = page.getByRole("dialog")
  await expect(
    discardDialog.getByRole("heading", { name: "Discard unsaved changes?" }),
  ).toBeVisible()
  await discardDialog.getByRole("button", { name: "Discard changes" }).click()
  await expect(page.getByLabel("Field name")).toHaveValue("meter_reading_kwh")
  await page.getByLabel("Field name").fill("current_reading_kwh")
  await saveCustomFieldsButton.scrollIntoViewIfNeeded()
  await saveCustomFieldsButton.click()
  await expect(
    page.getByText("Custom fields saved as schema version 2"),
  ).toBeVisible()

  await page.getByRole("link", { name: "Back to categories" }).click()
  await openCategoryAction(page, categoryName, "Manage custom fields")
  await page.getByRole("button", { name: "Remove" }).click()
  await expect(page.getByText("No custom fields configured yet.")).toBeVisible()
  await saveCustomFieldsButton.scrollIntoViewIfNeeded()
  await saveCustomFieldsButton.click()
  await expect(
    page.getByText("Custom fields saved as schema version 3"),
  ).toBeVisible()

  await page.getByRole("button", { name: "Edit JSON" }).click()
  await page.getByLabel("JSON schema").fill(`{
  "type": "object",
  "properties": {
    "account_code": {
      "type": "string",
      "pattern": "^[A-Z]+$"
    }
  },
  "required": ["account_code"],
  "additionalProperties": false
}`)
  await page.getByRole("button", { name: "Apply JSON" }).click()
  await page.getByRole("button", { name: "Save as new version" }).click()
  await expect(
    page.getByText("Custom fields saved as schema version 4"),
  ).toBeVisible()
  await expect(page.getByLabel("JSON schema")).toHaveValue(/"pattern"/)
})

test("shows the empty category custom-data history", async ({ page }) => {
  const ledgerName = uniqueName("Custom data")
  const groupName = uniqueName("Utilities")
  const categoryName = uniqueName("Electricity")

  await page.goto("/ledgers")
  await page.getByRole("button", { name: "New ledger" }).click()
  await page.getByLabel("Name").fill(ledgerName)
  await page.getByRole("button", { name: "Create ledger" }).click()
  await page.getByRole("link", { name: ledgerName }).click()
  await openCategories(page)
  await page.getByRole("button", { name: "New group" }).click()
  await page.getByLabel("Name").fill(groupName)
  await page.getByRole("button", { name: "Create group" }).click()
  await page.getByRole("button", { name: "New category" }).click()
  await page.getByLabel("Group").click()
  await page.getByRole("option", { name: groupName }).click()
  await page.getByLabel("Name").fill(categoryName)
  await page.getByLabel("Code").fill("DATA")
  const createCategoryButton = page.getByRole("button", {
    name: "Create category",
  })
  await createCategoryButton.scrollIntoViewIfNeeded()
  await createCategoryButton.click()

  await expect(
    page.getByRole("link", {
      name: `View custom data for ${categoryName}`,
    }),
  ).toHaveCount(0)

  await openCategoryAction(page, categoryName, "Manage custom fields")
  await page.getByRole("button", { name: "Add field" }).click()
  await page.getByLabel("Field name").fill("meter_reading")
  await page.getByLabel("Label").fill("Meter reading")
  await page.getByRole("checkbox", { name: "Required" }).check()
  await page.getByLabel("Minimum length").fill("1")
  const saveCustomFieldsButton = page.getByRole("button", {
    name: "Save custom fields",
  })
  await saveCustomFieldsButton.scrollIntoViewIfNeeded()
  await saveCustomFieldsButton.click()
  await expect(
    page.getByText("Custom fields saved as schema version 1"),
  ).toBeVisible()

  await page.getByRole("link", { name: "Back to categories" }).click()
  const customDataLink = page.getByRole("link", {
    name: `View custom data for ${categoryName}`,
  })
  await customDataLink.click()
  await expect(
    page.getByText(
      "No custom data records have been saved for this category yet.",
    ),
  ).toBeVisible()
})

test("filters the category table and moves a category between groups", async ({
  page,
}) => {
  const ledgerName = uniqueName("Category table")
  const firstGroup = uniqueName("Housing")
  const secondGroup = uniqueName("Utilities")
  const categoryName = uniqueName("Rent")

  await page.goto("/ledgers")
  await page.getByRole("button", { name: "New ledger" }).click()
  await page.getByLabel("Name").fill(ledgerName)
  await page.getByRole("button", { name: "Create ledger" }).click()
  await page.getByRole("link", { name: ledgerName }).click()
  await openCategories(page)

  for (const groupName of [firstGroup, secondGroup]) {
    await page.getByRole("button", { name: "New group" }).click()
    await page.getByLabel("Name").fill(groupName)
    await page.getByRole("button", { name: "Create group" }).click()
  }

  await page.getByRole("button", { name: "New category" }).click()
  await page.getByLabel("Group").click()
  await page.getByRole("option", { name: firstGroup }).click()
  await page.getByLabel("Name").fill(categoryName)
  await page.getByLabel("Code").fill("RENT")
  await page.getByRole("button", { name: "Create category" }).click()

  await page.getByPlaceholder("Search name or code").fill("RENT")
  await expect(page.getByText(categoryName, { exact: true })).toBeVisible()
  await expect(page.getByText(firstGroup, { exact: true })).toBeVisible()

  await openCategoryAction(page, categoryName, "Edit category")
  await page.getByLabel("Group").click()
  await page.getByRole("option", { name: secondGroup }).click()
  await page.getByRole("button", { name: "Save changes" }).click()
  await expect(page.getByText("Category updated")).toBeVisible()
  await expect(page.getByText(secondGroup, { exact: true })).toBeVisible()
})
