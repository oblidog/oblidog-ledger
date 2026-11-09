import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router"
import { Suspense } from "react"
import { useTranslation } from "react-i18next"
import { ObligationWorkspace } from "@/components/Obligations/ObligationWorkspace"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { fetchPublicAppConfig, isDemoSetupPreview } from "@/config"
import { useLedgerCanEdit } from "@/hooks/useLedgerCanEdit"
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
  const { appConfig } = Route.useRouteContext()
  const demoPreview = isDemoSetupPreview(appConfig, location.searchStr)
  const canManageComponents = useLedgerCanEdit(ledgerId, isWorkspace)

  if (!isWorkspace) {
    return <Outlet />
  }

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <Suspense fallback={<ObligationWorkspaceSkeleton />}>
        <ObligationWorkspace
          key={demoPreview ? `${ledgerId}:setup-preview` : ledgerId}
          ledgerId={ledgerId}
          demoPreview={demoPreview}
          canEdit={
            canManageComponents &&
            !demoPreview &&
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
