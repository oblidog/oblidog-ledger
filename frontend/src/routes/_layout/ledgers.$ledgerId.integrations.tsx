import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router"
import { IntegrationList } from "@/components/Integrations/IntegrationList"

export const Route = createFileRoute("/_layout/ledgers/$ledgerId/integrations")(
  {
    component: LedgerIntegrations,
    head: () => ({ meta: [{ title: "Integrations - Oblidog" }] }),
  },
)

function LedgerIntegrations() {
  const { ledgerId } = Route.useParams()
  const location = useLocation()
  if (
    location.pathname.replace(/\/$/, "") !== `/ledgers/${ledgerId}/integrations`
  )
    return <Outlet />
  return <IntegrationList key={ledgerId} ledgerId={ledgerId} />
}
