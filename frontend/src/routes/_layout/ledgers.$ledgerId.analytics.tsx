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
    <div className="space-y-8">
      <AnalyticsDashboard ledgerId={ledgerId} />
      <ComponentHistoryExplorer ledgerId={ledgerId} />
    </div>
  )
}
