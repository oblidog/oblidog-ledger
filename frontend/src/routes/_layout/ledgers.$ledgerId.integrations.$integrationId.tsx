import { createFileRoute } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import { IntegrationDetails } from "@/components/Integrations/IntegrationDetails"
import { i18n } from "@/i18n"

export const Route = createFileRoute(
  "/_layout/ledgers/$ledgerId/integrations/$integrationId",
)({
  component: LedgerIntegration,
  head: () => ({
    meta: [{ title: i18n.t("app:ledgers.integration_details_oblidog") }],
  }),
})

function LedgerIntegration() {
  useTranslation()

  const { ledgerId, integrationId } = Route.useParams()
  return (
    <IntegrationDetails
      key={`${ledgerId}:${integrationId}`}
      ledgerId={ledgerId}
      integrationId={integrationId}
    />
  )
}
