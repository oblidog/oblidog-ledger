// @ts-nocheck
import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link, notFound } from "@tanstack/react-router"
import { ArrowLeft, Database, ListPlus } from "lucide-react"
import { useState } from "react"

import {
  ApiError,
  CategoriesService,
  type CategoryDataRecordPublic,
} from "@/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

const PAGE_SIZE = 20

export const Route = createFileRoute(
  "/_layout/ledgers/$ledgerId/categories/$categoryId/data",
)({
  component: CategoryDataHistory,
  head: () => ({ meta: [{ title: "Category data - Oblidog" }] }),
})

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))
}

function formatValue(value: unknown) {
  if (value === null || value === undefined) return "—"
  if (typeof value === "boolean") return value ? "Yes" : "No"
  if (typeof value === "object") return JSON.stringify(value)
  return String(value)
}

function RecordCard({ record }: { record: CategoryDataRecordPublic }) {
  return (
    <section className="min-w-0 space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">Observed {formatTimestamp(record.observed_at)}</p>
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">Schema v{record.schema_version}</Badge>
          {record.source && <Badge variant="outline">{record.source}</Badge>}
        </div>
      </div>
      <div className="max-w-full overflow-x-auto">
        <dl className="grid min-w-0 gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
          {Object.entries(record.data).map(([key, value]) => (
            <div key={key} className="flex min-w-0 justify-between gap-3">
              <dt className="shrink-0 text-muted-foreground">{key}</dt>
              <dd className="min-w-0 break-words text-right font-medium">
                {formatValue(value)}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  )
}

function CategoryDataHistory() {
  const { ledgerId, categoryId } = Route.useParams()
  const [page, setPage] = useState(0)
  const offset = page * PAGE_SIZE

  const categoriesQuery = useQuery({
    queryFn: () =>
      CategoriesService.readCategories({ ledgerId, includeArchived: true }),
    queryKey: ["categories", ledgerId, true],
    retry: false,
  })
  const category = categoriesQuery.data?.data.find((item) => item.id === categoryId)

  const recordsQuery = useQuery({
    queryKey: ["category-data-records", ledgerId, categoryId, PAGE_SIZE, offset],
    queryFn: async () => {
      try {
        return await CategoriesService.readCategoryDataRecords({
          ledgerId,
          categoryId,
          limit: PAGE_SIZE,
          offset,
        })
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null
        throw error
      }
    },
    enabled: categoriesQuery.isSuccess && Boolean(category),
    retry: false,
    placeholderData: (previousData) => previousData,
  })

  if (categoriesQuery.isSuccess && !category) throw notFound()

  if (categoriesQuery.isLoading) {
    return (
      <div className="mx-auto w-full max-w-4xl space-y-6">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-48 w-full" />
      </div>
    )
  }

  if (categoriesQuery.isError) {
    return (
      <div className="mx-auto w-full max-w-4xl">
        <p className="rounded-md border border-destructive/50 p-4 text-sm text-destructive">
          Could not load the selected category.
        </p>
      </div>
    )
  }

  if (!category) return null

  const count = recordsQuery.data?.count ?? 0
  const pageStart = count === 0 ? 0 : offset + 1
  const pageEnd = Math.min(offset + PAGE_SIZE, count)
  const canGoNext = offset + PAGE_SIZE < count

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-4xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" size="sm" className="w-fit" asChild>
          <Link to="/ledgers/$ledgerId/categories" params={{ ledgerId }}>
            <ArrowLeft />
            Back to categories
          </Link>
        </Button>
        <Button variant="outline" size="sm" asChild>
          <Link
            to="/ledgers/$ledgerId/categories/$categoryId/custom-fields"
            params={{ ledgerId, categoryId }}
          >
            <ListPlus />
            Manage custom fields
          </Link>
        </Button>
      </div>

      <Card className="min-w-0">
        <CardHeader>
          <div className="mb-2 flex items-center gap-2">
            <Database className="size-5 text-primary" />
          </div>
          <h1 className="leading-none font-semibold">
            Custom data history for {category.name}
          </h1>
          <CardDescription>
            {recordsQuery.isLoading
              ? "Loading records…"
              : `${count} record${count === 1 ? "" : "s"} saved for this category.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="min-w-0 space-y-4">
          {recordsQuery.isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-28 w-full" />
              <Skeleton className="h-28 w-full" />
            </div>
          ) : recordsQuery.isError ? (
            <p className="rounded-md border border-destructive/50 p-3 text-sm text-destructive">
              Could not load the custom-data history.
            </p>
          ) : !recordsQuery.data || count === 0 ? (
            <p className="rounded-md border border-dashed p-5 text-center text-sm text-muted-foreground">
              No custom data records have been saved for this category yet.
            </p>
          ) : (
            <>
              <div className="space-y-3">
                {recordsQuery.data.data.map((record) => (
                  <RecordCard key={record.id} record={record} />
                ))}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                <p className="text-sm text-muted-foreground">
                  Showing {pageStart}–{pageEnd} of {count}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((current) => Math.max(0, current - 1))}
                    disabled={page === 0 || recordsQuery.isFetching}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((current) => current + 1)}
                    disabled={!canGoNext || recordsQuery.isFetching}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
