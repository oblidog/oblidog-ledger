import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import { IntegrationList } from "@/components/Integrations/IntegrationList"
import { i18n } from "@/i18n"

export const Route = createFileRoute("/_layout/ledgers/$ledgerId/integrations")(
  {
    component: LedgerIntegrations,
    head: () => ({
      meta: [{ title: i18n.t("app:ledgers.integrations_oblidog") }],
    }),
  },
)

function LedgerIntegrations() {
  useTranslation()

  const { ledgerId } = Route.useParams()
  const location = useLocation()
  if (
    location.pathname.replace(/\/$/, "") !== `/ledgers/${ledgerId}/integrations`
  )
    return <Outlet />
  return <IntegrationList key={ledgerId} ledgerId={ledgerId} />
}
