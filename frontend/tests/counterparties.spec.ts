import { expect, test } from "@playwright/test"

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

  const counterparty = await page.evaluate(async (name) => {
    const token = localStorage.getItem("access_token")
    const response = await fetch("/api/v1/counterparties", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name, short_name: "Enea" }),
    })
    if (!response.ok) throw new Error(`Counterparty creation failed: ${response.status}`)
    return (await response.json()) as { id: string; name: string }
  }, counterpartyName)

  const categoryCard = page
    .getByRole("heading", { name: "Counterparties" })
    .locator("..")
    .locator("..")
    .getByText(categoryName, { exact: true })
    .locator("../..")

  const search = categoryCard.getByLabel("Search counterparty")
  await search.fill(counterpartyName.slice(0, 8))
  await expect(page.getByText(counterpartyName, { exact: true })).toBeVisible()
  await page.getByText(counterpartyName, { exact: true }).click()

  await expect(categoryCard.getByText("Enea", { exact: true })).toBeVisible()
  await expect(page.getByText("Category counterparty updated")).toBeVisible()

  const categoryResponse = await page.evaluate(async () => {
    const token = localStorage.getItem("access_token")
    const response = await fetch(window.location.pathname.replace(/\/categories$/, "/categories"), {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!response.ok) throw new Error(`Categories read failed: ${response.status}`)
    return response.json()
  })
  const assigned = categoryResponse.data.find(
    (item: { name: string }) => item.name === categoryName,
  )
  expect(assigned.counterparty_id).toBe(counterparty.id)

  await categoryCard.getByRole("button", { name: "Clear counterparty" }).click()
  await expect(categoryCard.getByLabel("Search counterparty")).toBeVisible()
  await expect(page.getByText("Category counterparty updated")).toBeVisible()
})
