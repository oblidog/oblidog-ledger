import { useSuspenseQuery } from "@tanstack/react-query"
import {
  createFileRoute,
  Link,
  Outlet,
  useLocation,
} from "@tanstack/react-router"
import { ArrowLeft, Tags } from "lucide-react"
import { Suspense } from "react"

import { LedgersService } from "@/client"
import CategoryWorkspace from "@/components/Categories/CategoryWorkspace"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

export const Route = createFileRoute("/_layout/ledgers/$ledgerId/categories")({
  component: LedgerCategories,
  head: () => ({ meta: [{ title: "Categories - Oblidog" }] }),
})

function LedgerCategories() {
  const { ledgerId } = Route.useParams()
  const location = useLocation()
  const { data: ledger } = useSuspenseQuery({
    queryFn: () => LedgersService.readLedger({ ledgerId }),
    queryKey: ["ledger", ledgerId],
  })

  if (location.pathname !== `/ledgers/${ledgerId}/categories`) {
    return <Outlet />
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <Button variant="ghost" size="sm" className="w-fit" asChild>
          <Link to="/ledgers/$ledgerId" params={{ ledgerId }}>
            <ArrowLeft />
            Back to obligations
          </Link>
        </Button>
        <div>
          <div className="mb-2 flex items-center gap-2">
            <Tags className="size-5 text-primary" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">{ledger.name}</h1>
          <p className="mt-1 text-muted-foreground">
            Manage category groups and categories for this ledger.
          </p>
        </div>
      </div>
      <Suspense fallback={<CategoryWorkspaceSkeleton />}>
        <CategoryWorkspace ledgerId={ledgerId} />
      </Suspense>
    </div>
  )
}

function CategoryWorkspaceSkeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {Array.from({ length: 2 }, (_, index) => (
        <Card key={index}>
          <CardContent className="space-y-4 pt-6">
            <Skeleton className="h-6 w-1/3" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
