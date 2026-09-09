import { expect, type Page, test } from "@playwright/test"
import type {
  IntegrationCreate,
  IntegrationPublic,
  IntegrationUpdate,
} from "../src/client"

// These UI scenarios intercept every API request and never use a live database.
test.use({ storageState: { cookies: [], origins: [] } })
const ledgerId = "11111111-1111-4111-8111-111111111111"
const instanceId = "22222222-2222-4222-8222-222222222222"
const categoryId = "33333333-3333-4333-8333-333333333333"
const root = `/ledgers/${ledgerId}/integrations`
const now = "2026-09-08T12:00:00Z"
const base: IntegrationPublic = {
  id: instanceId,
  ledger_id: ledgerId,
  key: "nju-personal",
  provider: "nju",
  name: "NJU personal",
  category_ids: [categoryId],
  enabled: true,
  created_at: now,
  updated_at: now,
  enabled_at: now,
  stale_after_seconds: 93600,
  run_timeout_seconds: 1800,
  revision: 1,
  current_run_id: null,
  current_started_at: null,
  current_deadline_at: null,
  current_finished_at: null,
  last_finished_at: null,
  last_result: null,
  last_changes_detected: null,
  last_error_code: null,
  last_error_message: null,
  last_success_at: null,
  execution_state: "never_run",
  is_stale: false,
  health: "never_run",
}

async function mockApi(
  page: Page,
  options: {
    owner?: boolean
    demo?: boolean
    items?: IntegrationPublic[]
  } = {},
) {
  const state = {
    items: structuredClone(options.items ?? [base]),
    writes: [] as Array<{
      method: string
      body: IntegrationCreate | IntegrationUpdate
    }>,
    conflict: false,
    duplicate: false,
    failList: false,
    failCategories: false,
  }
  const user = {
    id: options.owner === false ? "member" : "owner",
    email: "owner@example.com",
    full_name: "Test user",
    is_active: true,
    is_superuser: false,
  }
  const ledger = {
    id: ledgerId,
    owner_user_id: "owner",
    name: "Home",
    description: null,
    created_at: now,
    updated_at: now,
  }
  await page.addInitScript(() =>
    localStorage.setItem("access_token", "mock-session"),
  )
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname.replace(/\/$/, "")
    const method = route.request().method()
    const reply = (body: unknown, status = 200) =>
      route.fulfill({ status, json: body })
    if (path.endsWith("/utils/public-config"))
      return reply({
        environment: options.demo ? "demo" : "local",
        is_demo: options.demo ?? false,
        demo_credentials: null,
      })
    if (path.endsWith("/users/me")) return reply(user)
    if (path === "/api/v1/ledgers") return reply({ data: [ledger], count: 1 })
    if (path === `/api/v1/ledgers/${ledgerId}`) return reply(ledger)
    if (path.endsWith("/categories"))
      return state.failCategories
        ? reply({ detail: "unavailable" }, 503)
        : reply({
            data: [
              {
                id: categoryId,
                ledger_id: ledgerId,
                name: "Phone",
                code: "PHONE",
                archived_at: null,
              },
            ],
            count: 1,
          })
    if (path === `/api/v1${root}`) {
      if (method === "POST") {
        const body = route.request().postDataJSON() as IntegrationCreate
        state.writes.push({ method, body })
        if (state.duplicate)
          return reply({ detail: { code: "duplicate_key" } }, 409)
        const item = { ...base, ...body }
        state.items.push(item)
        return reply(item, 201)
      }
      if (state.failList) return reply({ detail: "unavailable" }, 503)
      const offset = Number(url.searchParams.get("offset") ?? 0)
      const limit = Number(url.searchParams.get("limit") ?? 100)
      return reply({
        data: state.items.slice(offset, offset + limit),
        count: state.items.length,
      })
    }
    if (path.startsWith(`/api/v1${root}/`)) {
      const item = state.items.find(
        (entry) => entry.id === path.split("/").slice(-1)[0],
      )
      if (!item) return reply({ detail: "Integration not found" }, 404)
      if (method === "PATCH") {
        const body = route.request().postDataJSON() as IntegrationUpdate
        state.writes.push({ method, body })
        if (state.conflict || body.expected_revision !== item.revision)
          return reply({ detail: { code: "revision_conflict" } }, 409)
        Object.assign(item, body, { revision: item.revision + 1 })
        if (!item.enabled) item.health = "disabled"
      }
      return reply(item)
    }
    // Allow only the empty read models used by the workspace after demo redirect.
    if (
      method === "GET" &&
      /\/(members|obligations|category-groups)$/.test(path)
    )
      return reply({ data: [], count: 0 })
    return reply({ detail: `Unexpected mock request: ${method} ${path}` }, 500)
  })
  return state
}

async function openCreate(page: Page) {
  await page.goto(root)
  await page.getByRole("button", { name: "Add integration" }).click()
  await page.getByLabel("Name", { exact: true }).fill("NJU second account")
  await page.getByLabel("Instance key").fill("nju-second")
  await page.getByLabel("Provider", { exact: true }).fill("nju")
}

test("owner registers an instance with categories and opens its details", async ({
  page,
}) => {
  const state = await mockApi(page, { items: [] })
  await page.goto(root)
  await expect(page.getByText("No integrations yet")).toBeVisible()
  await openCreate(page)
  await page.getByRole("checkbox", { name: "Phone (PHONE)" }).check()
  await page.getByRole("button", { name: "Create integration" }).click()
  await expect(page).toHaveURL(`${root}/${instanceId}`)
  await expect(
    page.getByRole("heading", { name: "NJU second account" }),
  ).toBeVisible()
  await expect(page.getByText("Phone (PHONE)", { exact: true })).toBeVisible()
  expect(state.writes[0].body).toMatchObject({
    key: "nju-second",
    provider: "nju",
    category_ids: [categoryId],
    run_timeout_seconds: 1800,
    stale_after_seconds: 93600,
  })
})

test("owner edits configuration, preserves identity and can disable and re-enable reporting", async ({
  page,
}) => {
  const state = await mockApi(page)
  await page.goto(`${root}/${instanceId}`)
  await page.getByRole("button", { name: "Configure", exact: true }).click()
  await expect(page.getByLabel("Instance key")).toBeDisabled()
  await expect(page.getByLabel("Provider", { exact: true })).toBeDisabled()
  await page.getByLabel("Name", { exact: true }).fill("Renamed instance")
  await page.getByRole("checkbox", { name: "Enabled", exact: true }).uncheck()
  await page.getByRole("checkbox", { name: "Phone (PHONE)" }).uncheck()
  await page.getByRole("button", { name: "Save changes" }).click()
  await expect(
    page.getByText("Reporting disabled", { exact: true }),
  ).toBeVisible()
  expect(state.writes[0].body).toMatchObject({
    expected_revision: 1,
    name: "Renamed instance",
    enabled: false,
    category_ids: [],
  })
  expect(state.writes[0].body).not.toHaveProperty("key")
  expect(state.writes[0].body).not.toHaveProperty("provider")
  await page.getByRole("button", { name: "Configure", exact: true }).click()
  await page.getByRole("checkbox", { name: "Enabled", exact: true }).check()
  await page.getByRole("button", { name: "Save changes" }).click()
  await expect(
    page.getByText("Reporting disabled", { exact: true }),
  ).toHaveCount(0)
  expect(state.writes[1].body).toMatchObject({
    expected_revision: 2,
    enabled: true,
  })
})

test("validates timeout relation and explains duplicate keys without losing input", async ({
  page,
}) => {
  const state = await mockApi(page)
  await openCreate(page)
  await page.getByLabel("Run timeout (seconds)", { exact: true }).fill("93600")
  await page.getByRole("button", { name: "Create integration" }).click()
  await expect(page.getByText(/Run timeout must be shorter/)).toBeVisible()
  expect(state.writes).toHaveLength(0)
  await page.getByLabel("Run timeout (seconds)", { exact: true }).fill("1800")
  state.duplicate = true
  await page.getByRole("button", { name: "Create integration" }).click()
  await expect(page.getByText(/This key is already used/)).toBeVisible()
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "NJU second account",
  )
})

test("polling preserves the edit snapshot and a revision conflict requires review", async ({
  page,
}) => {
  const state = await mockApi(page)
  await page.clock.install()
  await page.goto(`${root}/${instanceId}`)
  await page.getByRole("button", { name: "Configure", exact: true }).click()
  await page.getByLabel("Name", { exact: true }).fill("My unsaved name")
  state.items[0] = { ...state.items[0], revision: 2, name: "Changed elsewhere" }
  const refreshed = page.waitForResponse((response) =>
    new URL(response.url()).pathname.endsWith(`${root}/${instanceId}`),
  )
  await page.clock.fastForward(15_000)
  await refreshed
  await expect(
    page.getByRole("heading", { name: "Changed elsewhere" }),
  ).toBeVisible()
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "My unsaved name",
  )
  await page.getByRole("button", { name: "Save changes" }).click()
  await expect(
    page.getByText("Configuration changed", { exact: true }),
  ).toBeVisible()
  expect(state.writes[0].body).toMatchObject({ expected_revision: 1 })
  await expect(
    page.getByRole("button", { name: "Save changes" }),
  ).toBeDisabled()
  await page.getByRole("button", { name: "Close and review" }).click()
  await page.getByRole("button", { name: "Configure", exact: true }).click()
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "Changed elsewhere",
  )
  await page.getByRole("button", { name: "Save changes" }).click()
  await expect(page.getByRole("dialog")).toHaveCount(0)
  expect(state.writes[1].body).toMatchObject({ expected_revision: 2 })
})

test("non-owner members can view list and details without configuration controls", async ({
  page,
}) => {
  const state = await mockApi(page, { owner: false })
  await page.goto(root)
  await expect(
    page.getByRole("link", { name: "NJU personal", exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Add integration" }),
  ).toHaveCount(0)
  await page.getByRole("link", { name: "NJU personal", exact: true }).click()
  await expect(
    page.getByRole("heading", { name: "NJU personal" }),
  ).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Configure", exact: true }),
  ).toHaveCount(0)
  await expect(
    page.getByText("Only the ledger owner can change configuration."),
  ).toBeVisible()
  expect(state.writes).toHaveLength(0)
})

test("shows timeout and stale reporting independently from the last result and renders errors as text", async ({
  page,
}) => {
  await mockApi(page, {
    items: [
      {
        ...base,
        health: "timed_out",
        execution_state: "timed_out",
        is_stale: true,
        last_result: "failure",
        last_success_at: now,
        last_finished_at: now,
        last_error_code: "provider_error",
        last_error_message: '<img src=x onerror="window.injected=true">',
        current_started_at: now,
        current_deadline_at: now,
      },
    ],
  })
  await page.goto(`${root}/${instanceId}`)
  await expect(page.getByText("Run timed out", { exact: true })).toBeVisible()
  await expect(page.getByText("Report overdue", { exact: true })).toBeVisible()
  await expect(page.getByText("Failure", { exact: true })).toBeVisible()
  await expect(page.getByText("Unknown", { exact: true })).toBeVisible()
  await expect(
    page.getByText('<img src=x onerror="window.injected=true">', {
      exact: true,
    }),
  ).toBeVisible()
  await expect(page.locator("img[src=x]")).toHaveCount(0)
  await expect(page.getByText("No success yet")).toHaveCount(0)
})

for (const changes of [true, false, null]) {
  test(`keeps successful changes=${changes} distinct`, async ({ page }) => {
    await mockApi(page, {
      items: [
        {
          ...base,
          health: "healthy",
          execution_state: "finished",
          last_result: "success",
          last_changes_detected: changes,
        },
      ],
    })
    await page.goto(root)
    await expect(
      page.getByText(
        changes === true
          ? "Changes detected"
          : changes === false
            ? "No changes"
            : "Unknown",
        { exact: true },
      ),
    ).toBeVisible()
  })
}

test("paginates all instances and recovers from a failed refresh", async ({
  page,
}) => {
  const state = await mockApi(page, {
    items: Array.from({ length: 25 }, (_, i) => ({
      ...base,
      id: `instance-${i}`,
      key: `nju-${i}`,
      name: `Account ${i}`,
    })),
  })
  await page.goto(root)
  await expect(
    page.getByRole("link", { name: "Account 0", exact: true }),
  ).toBeVisible()
  await page.getByRole("button", { name: "Next", exact: true }).click()
  await expect(
    page.getByRole("link", { name: "Account 24", exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Next", exact: true }),
  ).toBeDisabled()
  state.failList = true
  await page.getByRole("button", { name: "Refresh", exact: true }).click()
  await expect(
    page.getByText("Displayed data may be out of date."),
  ).toBeVisible({ timeout: 15_000 })
  state.failList = false
  await page.getByRole("button", { name: "Try again" }).click()
  await expect(
    page.getByText("Displayed data may be out of date."),
  ).toHaveCount(0)
})

test("blocks saving when categories cannot load and allows retry", async ({
  page,
}) => {
  const state = await mockApi(page)
  state.failCategories = true
  await openCreate(page)
  await expect(
    page.getByRole("button", { name: "Create integration" }),
  ).toBeDisabled()
  await expect(
    page.getByText("Could not load categories. Retry before saving."),
  ).toBeVisible({ timeout: 15_000 })
  state.failCategories = false
  await page.getByRole("button", { name: "Retry categories" }).click()
  await expect(
    page.getByRole("checkbox", { name: "Phone (PHONE)" }),
  ).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Create integration" }),
  ).toBeEnabled()
})

test("explains missing instances", async ({ page }) => {
  await mockApi(page, { items: [] })
  await page.goto(`${root}/${instanceId}`)
  await expect(
    page.getByText("Integration not found", { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Configure", exact: true }),
  ).toHaveCount(0)
})

test("demo hides navigation and blocks direct list and detail routes before fetching integrations", async ({
  page,
}) => {
  await mockApi(page, { demo: true })
  const requests: string[] = []
  page.on("request", (request) => {
    if (request.url().includes(`/api/v1${root}`)) requests.push(request.url())
  })
  for (const path of [root, `${root}/${instanceId}`]) {
    await page.goto(path)
    await expect(page).toHaveURL(`/ledgers/${ledgerId}`)
    await expect(
      page.getByRole("link", { name: "Integrations", exact: true }),
    ).toHaveCount(0)
  }
  expect(requests).toEqual([])
})

test("mobile menu reaches integrations and long content fits a 320px viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 })
  await mockApi(page, {
    items: [
      {
        ...base,
        name: "N".repeat(255),
        last_error_code: "provider_error",
        last_error_message: "X".repeat(1000),
        last_result: "failure",
        health: "error",
      },
    ],
  })
  await page.goto(`${root}/${instanceId}`)
  await expect(
    page.getByRole("heading", { name: "N".repeat(255) }),
  ).toBeVisible()
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true)
  await page.getByRole("button", { name: "Configure", exact: true }).click()
  await expect(page.getByRole("dialog")).toBeVisible()
  await expect
    .poll(() =>
      page
        .getByRole("dialog")
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    )
    .toBe(true)
  await page.getByRole("button", { name: "Cancel", exact: true }).click()
  await page.getByRole("button", { name: "More", exact: true }).first().click()
  await page.getByRole("link", { name: "Integrations", exact: true }).click()
  await expect(page).toHaveURL(root)
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true)
})
