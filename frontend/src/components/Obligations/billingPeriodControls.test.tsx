import { afterEach, beforeAll, expect, mock, spyOn, test } from "bun:test"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Window } from "happy-dom"
import { act } from "react"
import type { Root } from "react-dom/client"
import { i18n } from "@/i18n"
import { categoryQueryKeys } from "../Categories/categoryQueryKeys"

const browser = new Window({ url: "http://localhost" })
for (const [key, value] of Object.entries({
  window: browser,
  document: browser.document,
  navigator: browser.navigator,
  localStorage: browser.localStorage,
  IS_REACT_ACT_ENVIRONMENT: true,
  getComputedStyle: browser.getComputedStyle.bind(browser),
  MutationObserver: browser.MutationObserver,
  HTMLElement: browser.HTMLElement,
  Element: browser.Element,
  ResizeObserver: browser.ResizeObserver,
  requestAnimationFrame: browser.requestAnimationFrame.bind(browser),
  cancelAnimationFrame: browser.cancelAnimationFrame.bind(browser),
  HTMLInputElement: browser.HTMLInputElement,
  HTMLFormElement: browser.HTMLFormElement,
  DocumentFragment: browser.DocumentFragment,
  HTMLSelectElement: browser.HTMLSelectElement,
  Event: browser.Event,
  Node: browser.Node,
  NodeFilter: browser.NodeFilter,
  CustomEvent: browser.CustomEvent,
}))
  Object.defineProperty(globalThis, key, {
    value,
    configurable: true,
    writable: true,
  })
Object.assign(browser, {
  __OBLIDOG_CONFIG__: { VITE_API_URL: "http://localhost:8000" },
})

let createRoot: typeof import("react-dom/client").createRoot
let root: Root | undefined
let client: QueryClient | undefined
let Create: typeof import("./CreateObligationDialog").CreateObligationDialog
let Filter: typeof import("./ObligationFilters").PeriodFilter
beforeAll(async () => {
  createRoot = (await import("react-dom/client")).createRoot
  Create = (await import("./CreateObligationDialog")).CreateObligationDialog
  Filter = (await import("./ObligationFilters")).PeriodFilter
  await i18n.changeLanguage("en")
})
afterEach(async () => {
  await act(async () => root?.unmount())
  mock.restore()
  client?.clear()
  browser.document.body.innerHTML = ""
})
function container() {
  const element = browser.document.createElement("div")
  browser.document.body.append(element)
  root = createRoot(element as unknown as HTMLElement)
}

test.each([1970, 2199, 1969, 2200])(
  "creation respects billing year %i",
  async (year) => {
    client = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity } },
    })
    client.setQueryData(categoryQueryKeys.categories("ledger"), {
      data: [
        {
          id: "category",
          code: "TEST",
          name: "Test",
          data_source_policy: "manual",
          currency: "PLN",
        },
      ],
      count: 1,
    })
    container()
    await act(async () =>
      root!.render(
        <QueryClientProvider client={client!}>
          <Create
            ledgerId="ledger"
            defaultPeriod={{ year, month: 1 }}
            onSuccess={mock()}
            onError={mock()}
            firstPayment={{
              categoryCode: "TEST",
              obligationKey: "TEST-1970-01",
              onClose: mock(),
              onResolved: mock(),
            }}
          />
        </QueryClientProvider>,
      ),
    )
    const input =
      browser.document.querySelector<HTMLInputElement>("#obligation-period")!
    expect(input.min).toBe("1970-01")
    expect(input.max).toBe("2199-12")
    const button = [...browser.document.querySelectorAll("button")].find(
      (element) =>
        element.textContent?.includes(
          i18n.t("app:obligations.create_obligation"),
        ),
    )!
    expect(button.disabled).toBe(year < 1970 || year > 2199)
  },
)

test("custom period filter rejects unsupported years", async () => {
  container()
  await act(async () => root!.render(<Filter value={[]} onChange={mock()} />))
  await act(async () => {
    const select = browser.document.querySelector("select")!
    select.value = "custom"
    select.dispatchEvent(new browser.Event("change", { bubbles: true }))
  })
  const input = browser.document.querySelector<HTMLInputElement>(
    'input[type="month"]',
  )!
  expect(input.min).toBe("1970-01")
  expect(input.max).toBe("2199-12")
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      browser.HTMLInputElement.prototype,
      "value",
    )!.set!
    input.focus()
    setter.call(input, "1969-12")
    input.dispatchEvent(new browser.Event("input", { bubbles: true }))
    input.dispatchEvent(new browser.Event("change", { bubbles: true }))
    input.dispatchEvent(new browser.KeyboardEvent("keyup", { bubbles: true }))
  })
  expect(browser.document.querySelector("button")!.disabled).toBe(true)
})

test.each([
  "ready",
  "error",
  "draft",
  "collecting_data",
  "paid",
  "canceled",
] as const)(
  "details show the payment method for %s; editing lives in the edit form",
  async (lifecycle) => {
    const { ObligationPaymentExecution } = await import(
      "./ObligationPaymentExecution"
    )
    container()
    await act(async () =>
      root!.render(
        <ObligationPaymentExecution
          obligation={
            {
              lifecycle,
              payment_execution: "automatic_collection",
            } as import("@/client").ObligationPublic
          }
        />,
      ),
    )
    expect(browser.document.querySelector('[role="combobox"]')).toBeNull()
    expect(browser.document.body.textContent).toContain(
      i18n.t("app:obligations.payment_execution_automatic_collection"),
    )
  },
)

test.each(["automatic_collection", "scheduled_transfer"] as const)(
  "creating a %s payment does not schedule the next obligation",
  async (execution) => {
    const { ObligationsService } = await import("@/client")
    const create = spyOn(
      ObligationsService,
      "createObligation",
    ).mockImplementation(
      async ({ requestBody }) =>
        ({
          key: `${requestBody.category_code}-2026-11`,
        }) as import("@/client").ObligationPublic,
    )
    client = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity } },
    })
    client.setQueryData(categoryQueryKeys.categories("ledger"), {
      data: [
        {
          id: "subscription",
          code: "SUBS",
          name: "Subscription",
          data_source_policy: "manual",
        },
        {
          id: "rent",
          code: "RENT",
          name: "Rent",
          data_source_policy: "manual",
        },
      ],
      count: 2,
    })
    container()
    const onSuccess = mock()
    await act(async () =>
      root!.render(
        <QueryClientProvider client={client!}>
          <Create
            ledgerId="ledger"
            defaultPeriod={{ year: 2026, month: 11 }}
            onError={mock()}
            onSuccess={onSuccess}
          />
        </QueryClientProvider>,
      ),
    )
    async function clickButton(label: string) {
      await act(async () => {
        const button = [...browser.document.querySelectorAll("button")].find(
          (item) => item.textContent?.trim() === label,
        )
        expect(button).toBeDefined()
        button!.click()
      })
    }
    async function chooseCategory(code: string) {
      await act(async () => {
        const select = browser.document.querySelector<HTMLSelectElement>(
          "#obligation-category",
        )!
        select.value = code
        select.dispatchEvent(new browser.Event("change", { bubbles: true }))
      })
    }
    await clickButton(i18n.t("app:obligations.new_obligation"))
    await chooseCategory("SUBS")
    await act(async () => {
      browser.document
        .querySelector("#obligation-payment-execution")!
        .dispatchEvent(
          new browser.KeyboardEvent("keydown", {
            key: "ArrowDown",
            bubbles: true,
          }),
        )
    })
    await act(async () => {
      const label = i18n.t(`app:obligations.payment_execution_${execution}`)
      const option = [
        ...browser.document.querySelectorAll<HTMLElement>('[role="option"]'),
      ].find((item) => item.textContent?.trim() === label)
      expect(option).toBeDefined()
      option!.click()
    })
    await clickButton(i18n.t("app:obligations.create_obligation"))
    expect(onSuccess).toHaveBeenCalledTimes(1)
    await clickButton(i18n.t("app:obligations.new_obligation"))
    await chooseCategory("RENT")
    await clickButton(i18n.t("app:obligations.create_obligation"))
    expect(create).toHaveBeenCalledTimes(2)
    expect(create.mock.calls[0][0].requestBody.payment_execution).toBe(
      execution,
    )
    expect(create.mock.calls[1][0].requestBody).toMatchObject({
      category_code: "RENT",
      payment_execution: undefined,
    })
  },
)

test("edit form saves the payment method without resending financial fields", async () => {
  const { EditObligationDialog } = await import("./EditObligationDialog")
  const { ObligationsService } = await import("@/client")
  const update = spyOn(
    ObligationsService,
    "updateObligation",
  ).mockResolvedValue({} as never)
  const onSuccess = mock()
  client = new QueryClient()
  container()
  await act(async () =>
    root!.render(
      <QueryClientProvider client={client!}>
        <EditObligationDialog
          ledgerId="ledger"
          open
          obligation={
            {
              key: "TEST-2026-11",
              period: { year: 2026, month: 11 },
              lifecycle: "collecting_data",
              current_amount: "37",
              issue_date: null,
              due_date: "2026-11-24",
              notes: null,
              currency: "PLN",
              payment_execution: null,
            } as import("@/client").ObligationPublic
          }
          onSuccess={onSuccess}
          onError={mock()}
          onOpenChange={mock()}
        />
      </QueryClientProvider>,
    ),
  )
  const save = () =>
    [...browser.document.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) =>
        button.textContent?.trim() === i18n.t("app:obligations.save_changes"),
    )!
  expect(save().disabled).toBe(true)
  await act(async () =>
    browser.document
      .querySelector("#obligation-payment-execution")!
      .dispatchEvent(
        new browser.KeyboardEvent("keydown", {
          key: "ArrowDown",
          bubbles: true,
        }),
      ),
  )
  await act(async () => {
    const option = [
      ...browser.document.querySelectorAll<HTMLElement>('[role="option"]'),
    ].find(
      (item) =>
        item.textContent?.trim() ===
        i18n.t("app:obligations.payment_execution_automatic_collection"),
    )!
    option.click()
  })
  expect(save().disabled).toBe(false)
  await act(async () => save().click())
  expect(update.mock.calls[0][0].requestBody).toEqual({
    payment_execution: "automatic_collection",
  })
  expect(onSuccess).toHaveBeenCalledTimes(1)
})

test("new obligation shows the category default and allows an explicit manual override", async () => {
  const { ObligationsService } = await import("@/client")
  const create = spyOn(
    ObligationsService,
    "createObligation",
  ).mockResolvedValue({} as never)
  client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity } },
  })
  client.setQueryData(categoryQueryKeys.categories("ledger"), {
    data: [
      {
        id: "cat",
        code: "SUBS",
        name: "Subscription",
        data_source_policy: "manual",
        currency: "PLN",
        automatic_collection: true,
      },
    ],
    count: 1,
  })
  container()
  await act(async () =>
    root!.render(
      <QueryClientProvider client={client!}>
        <Create
          ledgerId="ledger"
          defaultPeriod={{ year: 2026, month: 11 }}
          firstPayment={{
            categoryCode: "SUBS",
            obligationKey: "SUBS-2026-11",
            onClose: mock(),
            onResolved: mock(),
          }}
          onSuccess={mock()}
          onError={mock()}
        />
      </QueryClientProvider>,
    ),
  )
  expect(
    browser.document.querySelector("#obligation-payment-execution")
      ?.textContent,
  ).toContain(i18n.t("app:obligations.payment_execution_automatic_collection"))
  await act(async () =>
    browser.document
      .querySelector("#obligation-payment-execution")!
      .dispatchEvent(
        new browser.KeyboardEvent("keydown", {
          key: "ArrowDown",
          bubbles: true,
        }),
      ),
  )
  await act(async () => {
    const option = [
      ...browser.document.querySelectorAll<HTMLElement>('[role="option"]'),
    ].find(
      (item) =>
        item.textContent?.trim() ===
        i18n.t("app:obligations.payment_execution_manual"),
    )!
    option.click()
  })
  await act(async () =>
    [...browser.document.querySelectorAll<HTMLButtonElement>("button")]
      .find(
        (button) =>
          button.textContent?.trim() ===
          i18n.t("app:obligations.create_obligation"),
      )!
      .click(),
  )
  expect(create.mock.calls[0][0].requestBody.payment_execution).toBeNull()
})
