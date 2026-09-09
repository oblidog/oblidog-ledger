import { expect, test } from "@playwright/test"

const apiUrl = process.env.VITE_API_URL
if (!apiUrl) {
  throw new Error("VITE_API_URL is undefined")
}

function uniqueName(prefix: string) {
  return `${prefix} ${Math.random().toString(36).slice(2, 8)}`
}

test("manages category and obligation counterparties in contextual dialogs", async ({
  page,
}) => {
  const ledgerName = uniqueName("Counterparty ledger")
  const groupName = uniqueName("Utilities")
  const categoryName = uniqueName("Electricity")
  const firstCounterpartyName = uniqueName("Enea")
  const secondCounterpartyName = uniqueName("Nju")

  await page.goto("/ledgers")
  await page.getByRole("button", { name: "New ledger" }).click()
  await page.getByLabel("Name").fill(ledgerName)
  await page.getByRole("button", { name: "Create ledger" }).click()
  await page.getByRole("link", { name: ledgerName }).click()

  const token = await page.evaluate(() => localStorage.getItem("access_token"))
  if (!token) throw new Error("Missing access token")

  const ledgerId = new URL(page.url()).pathname.split("/")[2]
  if (!ledgerId) throw new Error("Unable to resolve ledger id")

  const createCounterparty = async (name: string, shortName: string) => {
    const response = await page.request.post(`${apiUrl}/api/v1/counterparties`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name, short_name: shortName },
    })
    expect(response.ok()).toBeTruthy()
    return (await response.json()) as { id: string; name: string }
  }

  const firstCounterparty = await createCounterparty(firstCounterpartyName, "Enea")
  const secondCounterparty = await createCounterparty(secondCounterpartyName, "Nju")

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

  const createCategoryDialog = page.getByRole("dialog")
  await createCategoryDialog
    .getByLabel("Search counterparty")
    .fill(firstCounterpartyName)
  await createCategoryDialog
    .getByRole("button", { name: "Enea", exact: true })
    .click()
  await createCategoryDialog
    .getByRole("button", { name: "Create category" })
    .click()
  await expect(createCategoryDialog).toBeHidden()

  const readCategories = () =>
    page.request.get(`${apiUrl}/api/v1/ledgers/${ledgerId}/categories`, {
      headers: { Authorization: `Bearer ${token}` },
    })

  let categoriesResponse = await readCategories()
  expect(categoriesResponse.ok()).toBeTruthy()
  let categories = (await categoriesResponse.json()) as {
    data: Array<{ id: string; name: string; counterparty_id: string | null }>
  }
  const category = categories.data.find((item) => item.name === categoryName)
  expect(category?.counterparty_id).toBe(firstCounterparty.id)

  await page
    .getByRole("button", { name: `More actions for ${categoryName}` })
    .click()
  await page.getByRole("menuitem", { name: "Edit category" }).click()
  const editDialog = page.getByRole("dialog")
  await expect(
    editDialog.getByRole("button", { name: "Clear counterparty" }),
  ).toBeVisible()
  await editDialog.getByRole("button", { name: "Clear counterparty" }).click()
  await editDialog.getByRole("button", { name: "Save changes" }).click()
  await expect(editDialog).toBeHidden()

  categoriesResponse = await readCategories()
  categories = (await categoriesResponse.json()) as {
    data: Array<{ id: string; name: string; counterparty_id: string | null }>
  }
  expect(
    categories.data.find((item) => item.name === categoryName)?.counterparty_id,
  ).toBeNull()

  await page
    .getByRole("button", { name: `More actions for ${categoryName}` })
    .click()
  await page.getByRole("menuitem", { name: "Edit category" }).click()
  const reassignDialog = page.getByRole("dialog")
  await reassignDialog
    .getByLabel("Search counterparty")
    .fill(firstCounterpartyName)
  await reassignDialog
    .getByRole("button", { name: "Enea", exact: true })
    .click()
  await reassignDialog.getByRole("button", { name: "Save changes" }).click()
  await expect(reassignDialog).toBeHidden()

  categoriesResponse = await readCategories()
  categories = (await categoriesResponse.json()) as {
    data: Array<{ id: string; name: string; counterparty_id: string | null }>
  }
  expect(
    categories.data.find((item) => item.name === categoryName)?.counterparty_id,
  ).toBe(firstCounterparty.id)

  await page.getByRole("link", { name: "Back to obligations" }).click()
  await page.getByRole("button", { name: "New obligation" }).click()
  const createObligationDialog = page.getByRole("dialog")
  await createObligationDialog
    .getByLabel("Category", { exact: true })
    .selectOption("CPUI")
  await createObligationDialog
    .getByRole("button", { name: "Create obligation" })
    .click()
  await expect(createObligationDialog).toBeHidden()

  const obligationsResponse = await page.request.get(
    `${apiUrl}/api/v1/ledgers/${ledgerId}/obligations`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  expect(obligationsResponse.ok()).toBeTruthy()
  const obligations = (await obligationsResponse.json()) as {
    data: Array<{
      key: string
      name: string
      counterparty_id: string | null
    }>
  }
  const obligation = obligations.data.find((item) => item.name === categoryName)
  expect(obligation).toBeTruthy()
  expect(obligation?.counterparty_id).toBe(firstCounterparty.id)

  await page
    .getByRole("button", { name: `Actions for ${categoryName}` })
    .click()
  await page.getByRole("menuitem", { name: "Counterparty" }).click()
  const obligationCounterpartyDialog = page.getByRole("dialog")
  await obligationCounterpartyDialog
    .getByLabel("Search counterparty")
    .fill(secondCounterpartyName)
  await obligationCounterpartyDialog
    .getByRole("button", { name: "Nju", exact: true })
    .click()
  await obligationCounterpartyDialog
    .getByRole("button", { name: "Save" })
    .click()
  await expect(obligationCounterpartyDialog).toBeHidden()

  const readObligation = () =>
    page.request.get(
      `${apiUrl}/api/v1/ledgers/${ledgerId}/obligations/${obligation!.key}`,
      { headers: { Authorization: `Bearer ${token}` } },
    )

  let obligationResponse = await readObligation()
  expect(obligationResponse.ok()).toBeTruthy()
  let obligationBody = (await obligationResponse.json()) as {
    counterparty_id: string | null
  }
  expect(obligationBody.counterparty_id).toBe(secondCounterparty.id)

  await page.reload()
  const obligationActions = page.getByRole("button", {
    name: `Actions for ${categoryName}`,
  })
  await expect(obligationActions).toBeVisible()
  await obligationActions.click()
  await page.getByRole("menuitem", { name: "Counterparty" }).click()
  const clearDialog = page.getByRole("dialog")
  await clearDialog
    .getByRole("button", { name: "Clear counterparty" })
    .click()
  await clearDialog.getByRole("button", { name: "Save" }).click()
  await expect(clearDialog).toBeHidden()

  obligationResponse = await readObligation()
  obligationBody = (await obligationResponse.json()) as {
    counterparty_id: string | null
  }
  expect(obligationBody.counterparty_id).toBeNull()
})
