import { expect, type Page, test } from "@playwright/test"

const ledgerId = "11111111-1111-4111-8111-111111111111"
const userId = "22222222-2222-4222-8222-222222222222"
test.use({ storageState: { cookies: [], origins: [] } })

async function workspace(
  page: Page,
  language: string,
  theme: string,
  owner = true,
) {
  await page.addInitScript(
    ({ language, theme }) => {
      localStorage.setItem("oblidog-language", language)
      localStorage.setItem("vite-ui-theme", theme)
    },
    { language, theme },
  )
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/\/$/, "")
    const send = (json: unknown) => route.fulfill({ json })
    if (route.request().method() === "OPTIONS") return send({})
    if (path.endsWith("/utils/public-config"))
      return send({
        environment: "local",
        is_demo: false,
        demo_writes_enabled: false,
      })
    if (path.endsWith("/users/me"))
      return send({
        id: userId,
        email: "test@example.com",
        is_active: true,
        is_superuser: false,
        language,
      })
    const ledger = {
      id: ledgerId,
      name: "Unique workspace name",
      owner_user_id: owner ? userId : "other-owner",
      is_active: true,
      default_currency: "EUR",
    }
    if (path === "/api/v1/ledgers") return send({ data: [ledger], count: 1 })
    if (path === `/api/v1/ledgers/${ledgerId}`) return send(ledger)
    if (path.endsWith("/category-groups"))
      return send({
        data: [{ id: "group", name: "Household", is_active: true }],
        count: 1,
      })
    if (path.endsWith("/categories"))
      return send({
        data: [
          {
            id: "category",
            category_group_id: "group",
            name: "Electricity",
            code: "ELEC",
            is_active: true,
            currency: "EUR",
            data_source_policy: "manual",
          },
        ],
        count: 1,
      })
    if (path.includes("history-periods") || path.endsWith("/system-runs/tasks"))
      return send([])
    return send({ data: [], count: 0 })
  })
}

const titles = {
  en: ["Categories", "Obligations", "Integrations", "Analytics"],
  pl: ["Kategorie", "Zobowiązania", "Integracje", "Analizy"],
  de: [
    "Kategorien",
    "Zahlungsverpflichtungen",
    "Integrationen",
    "Auswertungen",
  ],
}
for (const language of ["en", "pl", "de"] as const) {
  for (const theme of ["light", "dark"]) {
    test(`${language} ${theme}: one page heading and no repeated workspace context`, async ({
      page,
    }) => {
      await workspace(page, language, theme)
      for (const [index, suffix] of [
        "/categories",
        "",
        "/integrations",
        "/analytics",
      ].entries()) {
        await page.goto(`/ledgers/${ledgerId}${suffix}`)
        const main = page.locator("main main")
        await expect(main.getByRole("heading", { level: 1 })).toHaveText(
          titles[language][index],
        )
        await expect(
          main.getByText("Unique workspace name", { exact: true }),
        ).toHaveCount(0)
        await expect(
          main.locator('a[href$="/system-run"], a[href="/"]'),
        ).toHaveCount(0)
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        ).toBe(true)
      }
    })
  }
}

test("ledger tools remain keyboard accessible and owner-only", async ({
  page,
}, info) => {
  await workspace(page, "en", "light")
  await page.goto(`/ledgers/${ledgerId}`)
  if (info.project.name === "mobile")
    await page
      .getByRole("button", { name: "More", exact: true })
      .first()
      .click()
  const switcher = page.getByTestId("ledger-switcher")
  await switcher.focus()
  await page.keyboard.press("Enter")
  await expect(page.getByRole("menu")).toContainText("Ledger tools")
  const run = page.getByRole("menuitem", { name: "System Run" })
  await expect(run).toBeVisible()
  await run.focus()
  await page.keyboard.press("Escape")
  await expect(switcher).toBeFocused()
  await page.keyboard.press("Enter")
  await run.focus()
  await page.keyboard.press("Enter")
  await expect(page).toHaveURL(`/ledgers/${ledgerId}/system-run`)
  if (info.project.name === "mobile")
    await expect(page.getByRole("dialog", { name: "Sidebar" })).toHaveCount(0)
})

test("viewers cannot access System run from ledger tools", async ({
  page,
}, info) => {
  await workspace(page, "en", "light", false)
  await page.goto(`/ledgers/${ledgerId}`)
  if (info.project.name === "mobile")
    await page
      .getByRole("button", { name: "More", exact: true })
      .first()
      .click()
  await page.getByTestId("ledger-switcher").click()
  await expect(page.getByRole("menuitem", { name: "System Run" })).toHaveCount(
    0,
  )
})

test("category filters and primary action survive the simpler table", async ({
  page,
}, info) => {
  await workspace(page, "en", "dark")
  await page.goto(`/ledgers/${ledgerId}/categories`)
  await expect(
    page.getByRole("cell", { name: "ELEC", exact: true }),
  ).toBeVisible()
  await page.screenshot({
    path: info.outputPath("categories.png"),
    fullPage: true,
  })
  const search = page.getByRole("textbox", { name: "Search name or code" })
  await search.fill("no match")
  await expect(
    page.getByRole("cell", { name: "ELEC", exact: true }),
  ).toHaveCount(0)
  await search.fill("ELEC")
  await expect(
    page.getByRole("cell", { name: "ELEC", exact: true }),
  ).toBeVisible()
  await page.getByRole("combobox", { name: "Group", exact: true }).click()
  await page.getByRole("option", { name: "Household", exact: true }).click()
  await expect(page).toHaveURL(/group=group/)
  await page.getByRole("combobox", { name: "Status", exact: true }).click()
  await page.getByRole("option", { name: "Archived", exact: true }).click()
  await expect(
    page.getByRole("cell", { name: "ELEC", exact: true }),
  ).toHaveCount(0)
  await expect(page).toHaveURL(/status=archived/)
  await page.getByRole("button", { name: "New category", exact: true }).click()
  await expect(page.getByRole("dialog")).toBeVisible()
})
