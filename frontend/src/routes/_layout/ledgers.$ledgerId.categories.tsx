import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router"
import { Suspense } from "react"
import { useTranslation } from "react-i18next"
import CategoryWorkspace from "@/components/Categories/CategoryWorkspace"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { i18n } from "@/i18n"

export const Route = createFileRoute("/_layout/ledgers/$ledgerId/categories")({
  component: LedgerCategories,
  head: () => ({
    meta: [{ title: i18n.t("app:categories.categories_oblidog") }],
  }),
})

function LedgerCategories() {
  useTranslation()

  const { ledgerId } = Route.useParams()
  const location = useLocation()

  if (location.pathname !== `/ledgers/${ledgerId}/categories`) {
    return <Outlet />
  }

  return (
    <div className="flex flex-col gap-6">
      <Suspense fallback={<CategoryWorkspaceSkeleton />}>
        <CategoryWorkspace ledgerId={ledgerId} />
      </Suspense>
    </div>
  )
}

function CategoryWorkspaceSkeleton() {
  useTranslation()

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
