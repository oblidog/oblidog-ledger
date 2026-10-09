import { client } from "@/client/client.gen"

export type IntegrationRun = {
  id: string
  integration_id: string
  started_at: string
  deadline_at: string
  finished_at: string | null
  result: string | null
  changes_detected: boolean | null
  error_code: string | null
  error_message: string | null
}

export type IntegrationRunHistory = {
  data: IntegrationRun[]
  count: number
}

export async function listIntegrationRuns(
  ledgerId: string,
  integrationId: string,
  limit: number,
  offset: number,
  signal?: AbortSignal,
): Promise<IntegrationRunHistory> {
  const response = await client.get({
    responseType: "json",
    throwOnError: true,
    security: [{ key: "OAuth2PasswordBearer", scheme: "bearer", type: "http" }],
    url: "/api/v1/ledgers/{ledger_id}/integrations/{integration_id}/runs",
    path: { ledger_id: ledgerId, integration_id: integrationId },
    query: { limit, offset },
    signal,
  })
  return response.data as IntegrationRunHistory
}
