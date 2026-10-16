import { afterEach, beforeAll, expect, spyOn, test } from "bun:test"
import { zodResolver } from "@hookform/resolvers/zod"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Window } from "happy-dom"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { useTranslation } from "react-i18next"
import { z } from "zod"
import type { UserPublic } from "@/client"
import { i18n } from "./index"
import { useLocalizedForm } from "./useLocalizedForm"

const browser = new Window({ url: "http://localhost" })
Object.defineProperty(globalThis, "window", {
  value: browser,
  configurable: true,
})
Object.defineProperty(globalThis, "document", {
  value: browser.document,
  configurable: true,
})
Object.defineProperty(globalThis, "navigator", {
  value: browser.navigator,
  configurable: true,
})
Object.defineProperty(globalThis, "localStorage", {
  value: browser.localStorage,
  configurable: true,
})
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
Object.assign(browser, {
  __OBLIDOG_CONFIG__: { VITE_API_URL: "http://localhost:8000" },
})

let root: Root | undefined
let client: QueryClient
let api: typeof import("@/client")
let Provider: typeof import("./LanguageProvider").LanguageProvider
let Selector: typeof import("@/components/Common/LanguageSelector").LanguageSelector
let patch: ReturnType<typeof spyOn>
const user: UserPublic = {
  id: "user",
  email: "test@example.com",
  full_name: null,
  is_active: true,
  is_superuser: false,
  created_at: "2026-01-01T00:00:00Z",
  language: "en",
}

beforeAll(async () => {
  api = await import("@/client")
  Provider = (await import("./LanguageProvider")).LanguageProvider
  Selector = (await import("@/components/Common/LanguageSelector"))
    .LanguageSelector
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  client?.clear()
  patch?.mockRestore()
  browser.localStorage.clear()
  browser.document.body.innerHTML = ""
  await i18n.changeLanguage("en")
})

function NavigationLabel() {
  const { t } = useTranslation()
  return <p data-testid="label">{t("navigation.obligations")}</p>
}

async function mount(
  account: UserPublic | null,
  demo = false,
  extra?: React.ReactNode,
) {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  client.setQueryData(["currentUser"], account)
  client.setQueryData(["public-app-config"], { is_demo: demo })
  const container = browser.document.createElement("div")
  browser.document.body.append(container)
  root = createRoot(container as unknown as HTMLElement)
  await act(async () =>
    root!.render(
      <QueryClientProvider client={client}>
        <Provider>
          <Selector />
          <NavigationLabel />
          {extra}
        </Provider>
      </QueryClientProvider>,
    ),
  )
}

async function select(language: string) {
  await act(async () => {
    const select = browser.document.querySelector("select")!
    select.value = language
    select.dispatchEvent(new browser.Event("change", { bubbles: true }))
    // Query/mutation observers batch their notifications on the next task.
    await new Promise((resolve) => setTimeout(resolve, 30))
  })
}

test("anonymous selection updates labels, html lang and browser storage without API writes", async () => {
  patch = spyOn(api.UsersService, "updateUserMe")
  await mount(null)
  await select("pl")
  expect(browser.document.documentElement.lang).toBe("pl")
  expect(
    browser.document.querySelector('[data-testid="label"]')!.textContent,
  ).toBe("Zobowiązania")
  expect(browser.localStorage.getItem("oblidog-language")).toBe("pl")
  expect(patch).not.toHaveBeenCalled()
})

test("account selection persists through API and overrides a different anonymous choice", async () => {
  browser.localStorage.setItem("oblidog-language", "pl")
  patch = spyOn(api.UsersService, "updateUserMe").mockResolvedValue({
    ...user,
    language: "pl",
  })
  await mount(user)
  expect(browser.document.documentElement.lang).toBe("en")
  await select("pl")
  expect(patch).toHaveBeenCalledWith({ requestBody: { language: "pl" } })
  expect(client.getQueryData<UserPublic>(["currentUser"])?.language).toBe("pl")
  expect(browser.document.documentElement.lang).toBe("pl")
  await act(async () => {
    client.setQueryData(["currentUser"], { ...user, language: "en" })
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
  expect(browser.document.documentElement.lang).toBe("en")
  await act(async () => {
    client.setQueryData(["currentUser"], null)
    client.clear()
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
  expect(browser.document.documentElement.lang).toBe("pl")
})

test("shared demo selection never writes the account and survives remount", async () => {
  patch = spyOn(api.UsersService, "updateUserMe")
  await mount(user, true)
  await select("pl")
  expect(browser.document.documentElement.lang).toBe("pl")
  expect(patch).not.toHaveBeenCalled()
  expect(client.getQueryData<UserPublic>(["currentUser"])?.language).toBe("en")
  await act(async () => root!.unmount())
  client.clear()
  await mount(user, true)
  expect(browser.document.documentElement.lang).toBe("pl")
})

test("failed save leaves account preference, rendered language and local storage unchanged", async () => {
  patch = spyOn(api.UsersService, "updateUserMe").mockRejectedValue(
    new Error("offline"),
  )
  await mount(user)
  await select("pl")
  expect(patch).toHaveBeenCalledTimes(1)
  expect(browser.document.documentElement.lang).toBe("en")
  expect(client.getQueryData<UserPublic>(["currentUser"])?.language).toBe("en")
  expect(browser.localStorage.getItem("oblidog-language")).toBeNull()
})

const validationSchema = z.object({
  name: z.string().min(8, {
    error: () => i18n.t("app:auth.password_must_be_at_least_8_characters"),
  }),
})
function ValidationFixture() {
  const form = useLocalizedForm({
    resolver: zodResolver(validationSchema),
    defaultValues: { name: "short" },
  })
  const field = form.register("name")
  return (
    <form onSubmit={form.handleSubmit(() => {})}>
      <input {...field} aria-label="fixture" />
      <button type="submit">Validate</button>
      <p data-testid="validation">{form.formState.errors.name?.message}</p>
      <span data-testid="value">{form.watch("name")}</span>
    </form>
  )
}
test("existing errors revalidate on language changes without resetting the form", async () => {
  await mount(null, false, <ValidationFixture />)
  await act(async () => {
    browser.document
      .querySelector("form")!
      .dispatchEvent(
        new browser.Event("submit", { bubbles: true, cancelable: true }),
      )
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
  expect(
    browser.document.querySelector('[data-testid="validation"]')!.textContent,
  ).toBe("Password must be at least 8 characters")
  await select("pl")
  expect(
    browser.document.querySelector('[data-testid="validation"]')!.textContent,
  ).toBe("Hasło musi mieć co najmniej 8 znaków")
  expect(
    browser.document.querySelector('[data-testid="value"]')!.textContent,
  ).toBe("short")
})

test("history translates known states but preserves user notes and names", async () => {
  const { ObligationActionHistory } = await import(
    "@/components/Obligations/ObligationActionHistory"
  )
  const historySpy = spyOn(
    api.ObligationsService,
    "readObligationActions",
  ).mockResolvedValue({
    data: [
      {
        id: "action",
        obligation_id: "obligation",
        action: "values_updated",
        actor_type: "user",
        actor_id: "user",
        actor_display_name: "Custom_User",
        integration_id: null,
        run_id: null,
        metadata: {},
        created_at: "2026-01-01T12:00:00Z",
        changes: {
          notes: { from: "keep_old_notes", to: "keep_manual_notes" },
          lifecycle: { from: "draft", to: "ready" },
        },
      },
    ],
    count: 1,
  })
  try {
    await mount(
      null,
      false,
      <ObligationActionHistory ledgerId="ledger" obligationKey="key" />,
    )
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40))
    })
    await select("pl")
    const content = browser.document.body.textContent
    expect(content).toContain("Gotowe do opłacenia")
    expect(content).toContain("keep_manual_notes")
    expect(content).toContain("Custom_User")
    expect(content).not.toContain("keep manual notes")
  } finally {
    historySpy.mockRestore()
  }
})
