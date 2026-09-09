import { expect, test } from "@playwright/test"

import { apiUrl } from "../src/config"

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
  const createResponse = await page.request.post(`${apiUrl}/api/v1/counterparties`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: counterpartyName, short_name: "Enea" },
  })
  expect(createResponse.ok()).toBeTruthy()
  const counterparty = (await createResponse.json()) as { id: string; name: string }

  const categoryCard = page.getByTestId(
    `category-counterparty-${await page.evaluate(async ({ apiUrl, token, categoryName }) => {
      const response = await fetch(`${apiUrl}/api/v1${window.location.pathname}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!response.ok) throw new Error(`Categories read failed: ${response.status}`)
      const body = await response.json()
      return body.data.find((item: { name: string }) => item.name === categoryName).id
    }, { apiUrl, token, categoryName })}`,
  )

  const search = categoryCard.getByLabel("Search counterparty")
  await search.fill(counterpartyName.slice(0, 8))
  await expect(page.getByText(counterpartyName, { exact: true })).toBeVisible()
  await page.getByText(counterpartyName, { exact: true }).click()

  await expect(categoryCard.getByText("Enea", { exact: true })).toBeVisible()
  await expect(page.getByText("Category counterparty updated")).toBeVisible()

  const categoriesResponse = await page.request.get(
    `${apiUrl}/api/v1${new URL(page.url()).pathname}`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  expect(categoriesResponse.ok()).toBeTruthy()
  const categoryResponse = await categoriesResponse.json()
  const assigned = categoryResponse.data.find(
    (item: { name: string }) => item.name === categoryName,
  )
  expect(assigned.counterparty_id).toBe(counterparty.id)

  await categoryCard.getByRole("button", { name: "Clear counterparty" }).click()
  await expect(categoryCard.getByLabel("Search counterparty")).toBeVisible()
  await expect(page.getByText("Category counterparty updated")).toBeVisible()
})
