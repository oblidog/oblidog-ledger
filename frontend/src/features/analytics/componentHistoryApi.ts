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
  }[]
}

export async function readComponentHistory(args: {
  ledgerId: string
  categoryId: string
  endYear: number
  endMonth: number
  periods?: number
  matchBy: ComponentHistoryMatchBy
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
    },
  })
  return response.data as ComponentHistoryResponse
}
