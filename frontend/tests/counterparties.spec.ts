import { expect, test } from "@playwright/test"

const apiUrl = process.env.VITE_API_URL
if (!apiUrl) {
  throw new Error("VITE_API_URL is undefined")
}

function uniqueName(prefix: string) {
  return `${prefix} ${Math.random().toString(36).slice(2, 8)}`
}

test("assigns and clears a category counterparty through autocomplete", async ({
  page,
}) => {
  const ledgerName = uniqueName("Counterparty ledger")
  const groupName = uniqueName("Utilities")
  const categoryName = uniqueName("Electricity")
  const counterpartyName = uniqueName("Enea")

  await page.goto("/ledgers")
  await page.getByRole("button", { name: "New ledger" }).click()
  await page.getByLabel("Name").fill(ledgerName)
  await page.getByRole("button", { name: "Create ledger" }).click()
  await page.getByRole("link", { name: ledgerName }).click()
  await page
    .locator('[data-sidebar="sidebar"]')
    .getByRole("link", { name: "Categories" })
    .click()

  await page.getByRole("button", { name: "New group" }).click()
  await page.getByLabel("Name").fill(groupName)
  await page.getByRole("button", { name: "Create group" }).click()

  await page.getByRole("button", { name: "New category" }).click()
  await page.getByLabel("Group").click()
  await page.getByRole("option", { name: groupName }).click()
  await page.getByLabel("Name").fill(categoryName)
  await page.getByLabel("Code").fill("CPUI")
  await page.getByRole("button", { name: "Create category" }).click()

  const token = await page.evaluate(() => localStorage.getItem("access_token"))
  if (!token) throw new Error("Missing access token")

  const ledgerId = new URL(page.url()).pathname.split("/")[2]
  if (!ledgerId) throw new Error("Unable to resolve ledger id")

  const createResponse = await page.request.post(`${apiUrl}/api/v1/counterparties`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: counterpartyName, short_name: "Enea" },
  })
  expect(createResponse.ok()).toBeTruthy()
  const counterparty = (await createResponse.json()) as { id: string; name: string }

  const readCategories = () =>
    page.request.get(`${apiUrl}/api/v1/ledgers/${ledgerId}/categories`, {
      headers: { Authorization: `Bearer ${token}` },
    })

  const categoriesResponse = await readCategories()
  expect(categoriesResponse.ok()).toBeTruthy()
  const categories = (await categoriesResponse.json()) as {
    data: Array<{ id: string; name: string; counterparty_id: string | null }>
  }
  const category = categories.data.find((item) => item.name === categoryName)
  expect(category).toBeTruthy()

  const categoryCard = page.getByTestId(`category-counterparty-${category!.id}`)
  const search = categoryCard.getByLabel("Search counterparty")
  await search.fill(counterpartyName.slice(0, 8))
  await expect(page.getByText(counterpartyName, { exact: true })).toBeVisible()
  await page.getByText(counterpartyName, { exact: true }).click()

  await expect(categoryCard.getByText("Enea", { exact: true })).toBeVisible()
  await expect(page.getByText("Category counterparty updated")).toBeVisible()

  const assignedResponse = await readCategories()
  expect(assignedResponse.ok()).toBeTruthy()
  const assignedCategories = (await assignedResponse.json()) as {
    data: Array<{ id: string; name: string; counterparty_id: string | null }>
  }
  const assigned = assignedCategories.data.find((item) => item.name === categoryName)
  expect(assigned?.counterparty_id).toBe(counterparty.id)

  await categoryCard.getByRole("button", { name: "Clear counterparty" }).click()
  await expect(categoryCard.getByLabel("Search counterparty")).toBeVisible()
  await expect(page.getByText("Category counterparty updated")).toBeVisible()
})
