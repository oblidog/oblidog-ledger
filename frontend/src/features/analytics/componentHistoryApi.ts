import { client } from "@/client/client.gen"

const oauthSecurity = [
  { key: "OAuth2PasswordBearer", scheme: "bearer", type: "http" },
] as const

export type ComponentHistoryMatchBy = "label" | "external_id"
export type ComponentHistoryState =
  | "added"
  | "present"
  | "changed"
  | "removed"
  | "missing"

export type ComponentHistoryResponse = {
  match_by: ComponentHistoryMatchBy
  periods: { year: number; month: number }[]
  components: {
    identity: string
    label: string
    type: string
    source: string | null
    external_id: string | null
    values: {
      period: { year: number; month: number }
      amount: string | null
      state: ComponentHistoryState
      label: string | null
      source: string | null
      external_id: string | null
    }[]
  }[]
  totals: {
    period: { year: number; month: number }
    amount: string | null
    currency: string | null
    obligation_amount: string | null
    unpriced_component_count: number
  }[]
}

export async function readComponentHistory(args: {
  ledgerId: string
  categoryId: string
  endYear: number
  endMonth: number
  periods?: number
  matchBy: ComponentHistoryMatchBy
  availableOnly?: boolean
}) {
  const response = await client.get({
    responseType: "json",
    security: oauthSecurity,
    throwOnError: true,
    url: "/api/v1/ledgers/{ledger_id}/analytics/component-history",
    path: { ledger_id: args.ledgerId },
    query: {
      category_id: args.categoryId,
      end_year: args.endYear,
      end_month: args.endMonth,
      periods: args.periods ?? 6,
      match_by: args.matchBy,
      available_only: args.availableOnly ?? false,
    },
  })
  return response.data as ComponentHistoryResponse
}

export type AvailableHistoryPeriod = {
  category_id: string
  period: { year: number; month: number }
  has_components: boolean
}

export async function readHistoryPeriods(ledgerId: string) {
  const response = await client.get({
    responseType: "json",
    security: oauthSecurity,
    throwOnError: true,
    url: "/api/v1/ledgers/{ledger_id}/analytics/history-periods",
    path: { ledger_id: ledgerId },
  })
  return response.data as AvailableHistoryPeriod[]
}
