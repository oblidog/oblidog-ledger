import { useQuery, useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router"
import { Suspense } from "react"
import { useTranslation } from "react-i18next"
import { LedgersService } from "@/client"
import { ObligationWorkspace } from "@/components/Obligations/ObligationWorkspace"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { fetchPublicAppConfig } from "@/config"
import useAuth from "@/hooks/useAuth"
import { i18n } from "@/i18n"

export const Route = createFileRoute("/_layout/ledgers/$ledgerId")({
  beforeLoad: async () => ({ appConfig: await fetchPublicAppConfig() }),
  component: LedgerDetails,
  head: () => ({ meta: [{ title: i18n.t("app:ledgers.ledger_oblidog") }] }),
})

function LedgerDetails() {
  useTranslation()

  const { ledgerId } = Route.useParams()
  const location = useLocation()
  const isWorkspace = location.pathname === `/ledgers/${ledgerId}`
  const { user: currentUser } = useAuth()
  const { appConfig } = Route.useRouteContext()
  const { data: ledger } = useSuspenseQuery({
    queryFn: () => LedgersService.readLedger({ ledgerId }),
    queryKey: ["ledger", ledgerId],
  })
  const members = useQuery({
    queryFn: () => LedgersService.readLedgerMembers({ ledgerId }),
    queryKey: ["ledger-members", ledgerId],
    enabled: isWorkspace && currentUser !== undefined,
  })
  const canManageComponents =
    ledger.owner_user_id === currentUser?.id ||
    members.data?.data.some(
      (member) =>
        member.user_id === currentUser?.id &&
        (member.role === "owner" || member.role === "editor"),
    ) === true

  if (!isWorkspace) {
    return <Outlet />
  }

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <Suspense fallback={<ObligationWorkspaceSkeleton />}>
        <ObligationWorkspace
          key={ledgerId}
          ledgerId={ledgerId}
          canEdit={
            canManageComponents &&
            (!appConfig.is_demo || appConfig.demo_writes_enabled)
          }
          defaultLifecycle={appConfig.is_demo ? "" : "unpaid"}
        />
      </Suspense>
    </div>
  )
}

function ObligationWorkspaceSkeleton() {
  useTranslation()

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <Skeleton className="h-6 w-1/3" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </CardContent>
    </Card>
  )
}
