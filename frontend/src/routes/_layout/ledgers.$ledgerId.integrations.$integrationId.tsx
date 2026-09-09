import { createFileRoute } from "@tanstack/react-router"
import { IntegrationDetails } from "@/components/Integrations/IntegrationDetails"

export const Route = createFileRoute(
  "/_layout/ledgers/$ledgerId/integrations/$integrationId",
)({
  component: LedgerIntegration,
  head: () => ({ meta: [{ title: "Integration details - Oblidog" }] }),
})

function LedgerIntegration() {
  const { ledgerId, integrationId } = Route.useParams()
  return (
    <IntegrationDetails
      key={`${ledgerId}:${integrationId}`}
      ledgerId={ledgerId}
      integrationId={integrationId}
    />
  )
}
