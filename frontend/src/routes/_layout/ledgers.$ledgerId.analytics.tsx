import { createFileRoute } from "@tanstack/react-router"

import { AnalyticsDashboard } from "@/components/Analytics/AnalyticsDashboard"

export const Route = createFileRoute("/_layout/ledgers/$ledgerId/analytics")({
  component: LedgerAnalytics,
  head: () => ({ meta: [{ title: "Analytics - Oblidog" }] }),
})

function LedgerAnalytics() {
  const { ledgerId } = Route.useParams()
  return <AnalyticsDashboard ledgerId={ledgerId} />
}
