import { client } from "@/client/client.gen"

const oauthSecurity = [
  {
    key: "OAuth2PasswordBearer",
    scheme: "bearer",
    type: "http",
  },
] as const

export type CounterpartySummary = {
  id: string
  name: string
  short_name: string | null
  logo_url: string | null
}

export type Counterparty = CounterpartySummary & {
  website_url: string | null
  created_at: string
  updated_at: string
}

export type CounterpartyInput = {
  name: string
  short_name: string | null
  logo_url: string | null
  website_url: string | null
}

export type CounterpartyListResponse = {
  data: Counterparty[]
  count: number
}

export type CounterpartySearchResponse = {
  items: CounterpartySummary[]
}

export type CategoryWithCounterparty = {
  id: string
  name: string
  code: string
  is_active: boolean
  counterparty_id: string | null
  counterparty: CounterpartySummary | null
}

export type ObligationWithCounterparty = {
  key: string
  name: string
  lifecycle: string
  current_amount: string | null
  currency: string | null
  due_date: string | null
  counterparty_id: string | null
  counterparty: CounterpartySummary | null
}

export async function listCounterparties() {
  const response = await client.get({
    responseType: "json",
    security: oauthSecurity,
    throwOnError: true,
    url: "/api/v1/counterparties",
  })

  return response.data as CounterpartyListResponse
}

export async function createCounterparty(input: CounterpartyInput) {
  const response = await client.post({
    responseType: "json",
    security: oauthSecurity,
    throwOnError: true,
    url: "/api/v1/counterparties",
    body: input,
    headers: { "Content-Type": "application/json" },
  })

  return response.data as Counterparty
}

export async function updateCounterparty(
  counterpartyId: string,
  input: Partial<CounterpartyInput>,
) {
  const response = await client.patch({
    responseType: "json",
    security: oauthSecurity,
    throwOnError: true,
    url: "/api/v1/counterparties/{counterparty_id}",
    path: { counterparty_id: counterpartyId },
    body: input,
    headers: { "Content-Type": "application/json" },
  })

  return response.data as Counterparty
}

export async function deleteCounterparty(counterpartyId: string) {
  const response = await client.delete({
    responseType: "json",
    security: oauthSecurity,
    throwOnError: true,
    url: "/api/v1/counterparties/{counterparty_id}",
    path: { counterparty_id: counterpartyId },
  })

  return response.data
}

export async function searchCounterparties(query: string, limit = 10) {
  const response = await client.get({
    responseType: "json",
    security: oauthSecurity,
    throwOnError: true,
    url: "/api/v1/counterparties/search",
    query: { q: query, limit },
  })

  return response.data as CounterpartySearchResponse
}

export async function assignCategoryCounterparty(
  ledgerId: string,
  categoryId: string,
  counterpartyId: string | null,
) {
  const response = await client.patch({
    responseType: "json",
    security: oauthSecurity,
    throwOnError: true,
    url: "/api/v1/ledgers/{ledger_id}/categories/{category_id}/counterparty",
    path: {
      ledger_id: ledgerId,
      category_id: categoryId,
    },
    body: { counterparty_id: counterpartyId },
    headers: { "Content-Type": "application/json" },
  })

  return response.data
}

export async function assignObligationCounterparty(
  ledgerId: string,
  obligationKey: string,
  counterpartyId: string | null,
) {
  const response = await client.patch({
    responseType: "json",
    security: oauthSecurity,
    throwOnError: true,
    url: "/api/v1/ledgers/{ledger_id}/obligations/{obligation_key}/counterparty",
    path: {
      ledger_id: ledgerId,
      obligation_key: obligationKey,
    },
    body: { counterparty_id: counterpartyId },
    headers: { "Content-Type": "application/json" },
  })

  return response.data as CounterpartySummary | null
}
