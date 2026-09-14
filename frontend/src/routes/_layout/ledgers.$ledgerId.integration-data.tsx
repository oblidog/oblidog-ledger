import { createFileRoute } from "@tanstack/react-router"

import { ComponentHistoryExplorer } from "@/components/Analytics/ComponentHistoryTable"
import { IntegrationDataCategoriesTable } from "@/components/Integrations/IntegrationDataCategoriesTable"

export const Route = createFileRoute(
  "/_layout/ledgers/$ledgerId/integration-data",
)({
  component: LedgerIntegrationData,
  head: () => ({ meta: [{ title: "Integration Data - Oblidog" }] }),
})

function LedgerIntegrationData() {
  const { ledgerId } = Route.useParams()

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-7xl flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Integration Data</h1>
        <p className="mt-1 text-muted-foreground">
          Review structured category data and compare obligation components
          across periods.
        </p>
      </div>

      <IntegrationDataCategoriesTable ledgerId={ledgerId} />
      <ComponentHistoryExplorer ledgerId={ledgerId} />
    </div>
  )
}
