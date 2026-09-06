import { expect, type Page, test } from "@playwright/test"

function uniqueName(prefix: string) {
  return `${prefix} ${Math.random().toString(36).slice(2, 8)}`
}

async function openCategories(page: Page) {
  await page
    .locator('[data-sidebar="sidebar"]')
    .getByRole("link", { name: "Categories" })
    .click()
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

test("opens category data as a responsive paginated page", async ({ page }) => {
  const ledgerName = uniqueName("Data history")
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
  await page.getByLabel("Code").fill("HIST")
  await page.getByRole("button", { name: "Create category" }).click()

  await openCategoryAction(page, categoryName, "Manage custom fields")
  await page.getByRole("button", { name: "Add field" }).click()
  await page.getByLabel("Field name").fill("reading")
  await page.getByLabel("Label").fill("Reading")
  await page.getByRole("button", { name: "Save custom fields" }).click()
  await expect(
    page.getByText("Custom fields saved as schema version 1"),
  ).toBeVisible()

  await page.getByRole("link", { name: "Back to categories" }).click()

  await page.route("**/data-records*", async (route) => {
    const requestUrl = new URL(route.request().url())
    const offset = Number(requestUrl.searchParams.get("offset") ?? "0")
    const start = offset === 0 ? 0 : 20
    const end = offset === 0 ? 20 : 21
    const data = Array.from({ length: end - start }, (_, index) => {
      const number = start + index + 1
      return {
        id: `record-${number}`,
        category_id: "test-category",
        schema_version: 1,
        observed_at: new Date(Date.UTC(2026, 0, number)).toISOString(),
        source: "test",
        data: {
          reading: number,
          note: "A very long custom value that must remain contained inside the record rather than widening the page viewport.",
        },
      }
    })
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data, count: 21 }),
    })
  })

  await page.setViewportSize({ width: 320, height: 800 })
  await page
    .getByRole("link", { name: `View custom data for ${categoryName}` })
    .click()

  await expect(page).toHaveURL(/\/categories\/[^/]+\/data$/)
  await expect(
    page.getByRole("heading", { name: `Custom data history for ${categoryName}` }),
  ).toBeVisible()
  await expect(page.getByText("21 records saved for this category.")).toBeVisible()
  await expect(page.getByText("Showing 1–20 of 21")).toBeVisible()

  const hasPageOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  )
  expect(hasPageOverflow).toBe(false)

  await page.getByRole("button", { name: "Next" }).click()
  await expect(page.getByText("Showing 21–21 of 21")).toBeVisible()
  await expect(page.getByRole("button", { name: "Next" })).toBeDisabled()

  await page.getByRole("link", { name: "Manage custom fields" }).click()
  await expect(page).toHaveURL(/\/custom-fields$/)
})
