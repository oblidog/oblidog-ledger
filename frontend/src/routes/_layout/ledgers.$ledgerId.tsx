import { useQuery, useSuspenseQuery } from "@tanstack/react-query"
import {
  createFileRoute,
  Link,
  Outlet,
  redirect,
  useLocation,
} from "@tanstack/react-router"
import { Play, Settings, Tags } from "lucide-react"
import { Suspense } from "react"

import { LedgersService } from "@/client"
import { ObligationWorkspace } from "@/components/Obligations/ObligationWorkspace"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { fetchPublicAppConfig } from "@/config"
import { ObligationCounterpartyPanel } from "@/features/counterparties/ObligationCounterpartyPanel"
import useAuth from "@/hooks/useAuth"
import { usePublicAppConfig } from "@/hooks/usePublicAppConfig"

export const Route = createFileRoute("/_layout/ledgers/$ledgerId")({
  beforeLoad: async ({ location, params }) => {
    const appConfig = await fetchPublicAppConfig()
    const restrictedDemoRoute =
      location.pathname === `/ledgers/${params.ledgerId}/settings` ||
      location.pathname === `/ledgers/${params.ledgerId}/system-run` ||
      location.pathname === `/ledgers/${params.ledgerId}/integrations` ||
      location.pathname.startsWith(`/ledgers/${params.ledgerId}/integrations/`)

    if (appConfig.is_demo && restrictedDemoRoute) {
      throw redirect({
        to: "/ledgers/$ledgerId",
        params: { ledgerId: params.ledgerId },
      })
    }
  },
  component: LedgerDetails,
  head: () => ({ meta: [{ title: "Ledger - Oblidog" }] }),
})

function LedgerDetails() {
  const { ledgerId } = Route.useParams()
  const location = useLocation()
  const isWorkspace = location.pathname === `/ledgers/${ledgerId}`
  const { user: currentUser } = useAuth()
  const { data: appConfig } = usePublicAppConfig()
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
      <div className="flex flex-col gap-4">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div className="hidden md:block">
            <h1 className="text-2xl font-bold tracking-tight">{ledger.name}</h1>
            <p className="mt-1 text-muted-foreground">
              {ledger.description ||
                "Review and manage obligations for this ledger."}
            </p>
          </div>
          <div className="hidden gap-2 md:flex">
            {ledger.owner_user_id === currentUser?.id &&
              !appConfig?.is_demo && (
                <Button variant="outline" asChild>
                  <Link
                    to="/ledgers/$ledgerId/system-run"
                    params={{ ledgerId }}
                  >
                    <Play />
                    System Run
                  </Link>
                </Button>
              )}
            <Button variant="outline" asChild>
              <Link to="/">Dashboard</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/ledgers/$ledgerId/categories" params={{ ledgerId }}>
                <Tags />
                Categories
              </Link>
            </Button>
            {!appConfig?.is_demo && (
              <Button variant="outline" size="icon" asChild>
                <Link
                  to="/ledgers/$ledgerId/settings"
                  params={{ ledgerId }}
                  aria-label="Ledger settings"
                >
                  <Settings />
                </Link>
              </Button>
            )}
          </div>
        </div>
      </div>
      <Suspense fallback={<ObligationWorkspaceSkeleton />}>
        <ObligationWorkspace
          ledgerId={ledgerId}
          canManageComponents={canManageComponents}
        />
      </Suspense>
      <ObligationCounterpartyPanel
        ledgerId={ledgerId}
        canEdit={canManageComponents}
      />
    </div>
  )
}

function ObligationWorkspaceSkeleton() {
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
