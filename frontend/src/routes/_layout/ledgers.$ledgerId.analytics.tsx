import { createFileRoute } from "@tanstack/react-router"

import { AnalyticsDashboard } from "@/components/Analytics/AnalyticsDashboard"
import { ComponentHistoryExplorer } from "@/components/Analytics/ComponentHistoryTable"

export const Route = createFileRoute("/_layout/ledgers/$ledgerId/analytics")({
  component: LedgerAnalytics,
  head: () => ({ meta: [{ title: "Analytics - Oblidog" }] }),
})

function LedgerAnalytics() {
  const { ledgerId } = Route.useParams()
  return (
    <div className="mx-auto flex w-full min-w-0 max-w-7xl flex-col gap-8">
      <AnalyticsDashboard ledgerId={ledgerId} />
      <ComponentHistoryExplorer ledgerId={ledgerId} />
    </div>
  )
}
