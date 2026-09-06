// @ts-nocheck
import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link, notFound } from "@tanstack/react-router"
import { ArrowLeft, ArrowUpDown, Database, ListPlus } from "lucide-react"
import { useEffect, useState } from "react"

import { ApiError, CategoriesService } from "@/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

const PAGE_SIZE = 20

type PropertySchema = {
  type?: string
  format?: string
  title?: string
  enum?: unknown[]
}

export const Route = createFileRoute(
  "/_layout/ledgers/$ledgerId/categories/$categoryId/data",
)({
  validateSearch: (search: Record<string, unknown>) => ({
    schema:
      typeof search.schema === "number"
        ? search.schema
        : typeof search.schema === "string" && Number(search.schema) > 0
          ? Number(search.schema)
          : undefined,
    from: typeof search.from === "string" ? search.from : undefined,
    to: typeof search.to === "string" ? search.to : undefined,
    sort: search.sort === "asc" ? "asc" : "desc",
  }),
  component: CategoryDataHistory,
  head: () => ({ meta: [{ title: "Category data - Oblidog" }] }),
})

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))
}

function formatCalendarDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return value
  const [, year, month, day] = match
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
    new Date(Number(year), Number(month) - 1, Number(day)),
  )
}

function formatSchemaValue(value: unknown, schema: PropertySchema) {
  if (value === null || value === undefined) return "—"

  if (schema.enum?.includes(value)) {
    return <Badge variant="outline">{String(value)}</Badge>
  }

  if (schema.type === "boolean" && typeof value === "boolean") {
    return (
      <Badge variant={value ? "secondary" : "outline"}>
        {value ? "Yes" : "No"}
      </Badge>
    )
  }

  if (
    (schema.type === "number" || schema.type === "integer") &&
    typeof value === "number"
  ) {
    return new Intl.NumberFormat().format(value)
  }

  if (schema.type === "string" && schema.format === "date") {
    return formatCalendarDate(String(value))
  }

  if (schema.type === "string" && schema.format === "date-time") {
    return formatTimestamp(String(value))
  }

  if (typeof value === "object") {
    const json = JSON.stringify(value)
    return (
      <details className="max-w-72 whitespace-normal">
        <summary className="cursor-pointer text-sm font-medium">View details</summary>
        <pre className="mt-2 max-h-48 overflow-auto rounded bg-muted p-2 text-xs">
          {json}
        </pre>
      </details>
    )
  }

  return String(value)
}

function dateStart(value?: string) {
  return value ? new Date(`${value}T00:00:00`).toISOString() : undefined
}

function dateEnd(value?: string) {
  return value ? new Date(`${value}T23:59:59.999`).toISOString() : undefined
}

function CategoryDataHistory() {
  const { ledgerId, categoryId } = Route.useParams()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const [page, setPage] = useState(0)

  const categoriesQuery = useQuery({
    queryFn: () =>
      CategoriesService.readCategories({ ledgerId, includeArchived: true }),
    queryKey: ["categories", ledgerId, true],
    retry: false,
  })
  const category = categoriesQuery.data?.data.find((item) => item.id === categoryId)

  const schemasQuery = useQuery({
    queryFn: () => CategoriesService.readCategoryDataSchemas({ ledgerId, categoryId }),
    queryKey: ["category-data-schemas", ledgerId, categoryId],
    enabled: categoriesQuery.isSuccess && Boolean(category),
    retry: false,
  })

  const activeSchema = schemasQuery.data?.data.find((schema) => schema.is_active)
  const selectedVersion = search.schema ?? activeSchema?.version
  const selectedSchema = schemasQuery.data?.data.find(
    (schema) => schema.version === selectedVersion,
  )

  useEffect(() => {
    setPage(0)
  }, [selectedVersion, search.from, search.to, search.sort])

  const queryFilters = {
    ledgerId,
    categoryId,
    schemaVersion: selectedVersion,
    observedFrom: dateStart(search.from),
    observedTo: dateEnd(search.to),
  }

  const countQuery = useQuery({
    queryKey: ["category-data-record-count", queryFilters],
    queryFn: async () => {
      try {
        return await CategoriesService.readCategoryDataRecords({
          ...queryFilters,
          limit: 1,
          offset: 0,
        })
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null
        throw error
      }
    },
    enabled: Boolean(selectedSchema),
    retry: false,
  })

  const count = countQuery.data?.count ?? 0
  const pageItemCount = Math.min(PAGE_SIZE, Math.max(0, count - page * PAGE_SIZE))
  const offset =
    search.sort === "asc"
      ? Math.max(0, count - (page + 1) * PAGE_SIZE)
      : page * PAGE_SIZE

  const recordsQuery = useQuery({
    queryKey: [
      "category-data-records",
      queryFilters,
      search.sort,
      PAGE_SIZE,
      page,
      count,
    ],
    queryFn: async () => {
      if (pageItemCount === 0) return { data: [], count }
      const response = await CategoriesService.readCategoryDataRecords({
        ...queryFilters,
        limit: pageItemCount,
        offset,
      })
      return search.sort === "asc"
        ? { ...response, data: [...response.data].reverse() }
        : response
    },
    enabled: Boolean(selectedSchema) && countQuery.isSuccess,
    retry: false,
    placeholderData: (previousData) => previousData,
  })

  if (categoriesQuery.isSuccess && !category) throw notFound()

  if (categoriesQuery.isLoading || schemasQuery.isLoading) {
    return (
      <div className="mx-auto w-full max-w-6xl space-y-6">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (categoriesQuery.isError || schemasQuery.isError) {
    return (
      <div className="mx-auto w-full max-w-6xl">
        <p className="rounded-md border border-destructive/50 p-4 text-sm text-destructive">
          Could not load the selected category data.
        </p>
      </div>
    )
  }

  if (!category) return null

  if (!activeSchema || !selectedSchema) {
    return (
      <div className="mx-auto w-full max-w-6xl space-y-4">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/ledgers/$ledgerId/categories" params={{ ledgerId }}>
            <ArrowLeft /> Back to categories
          </Link>
        </Button>
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          No custom-data schema is available for this category.
        </p>
      </div>
    )
  }

  const properties = Object.entries(selectedSchema.schema?.properties ?? {}) as [
    string,
    PropertySchema,
  ][]
  const pageStart = count === 0 ? 0 : page * PAGE_SIZE + 1
  const pageEnd = Math.min((page + 1) * PAGE_SIZE, count)
  const canGoNext = pageEnd < count

  const updateSearch = (patch: Record<string, unknown>) =>
    navigate({ search: (current) => ({ ...current, ...patch }), replace: true })

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-6xl flex-col gap-6">
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
            {countQuery.isLoading
              ? "Loading records…"
              : `${count} record${count === 1 ? "" : "s"} for schema version ${selectedVersion}.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="min-w-0 space-y-5">
          <div className="grid gap-3 md:grid-cols-4">
            <div className="space-y-1 text-sm">
              <span className="font-medium">Schema version</span>
              <Select
                value={String(selectedVersion)}
                onValueChange={(value) => updateSearch({ schema: Number(value) })}
              >
                <SelectTrigger className="w-full" aria-label="Schema version">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {schemasQuery.data?.data.map((schema) => (
                    <SelectItem key={schema.version} value={String(schema.version)}>
                      Version {schema.version}{schema.is_active ? " (active)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 text-sm">
              <label htmlFor="category-data-observed-from" className="font-medium">
                Observed from
              </label>
              <Input
                id="category-data-observed-from"
                type="date"
                value={search.from ?? ""}
                onChange={(event) => updateSearch({ from: event.target.value || undefined })}
              />
            </div>
            <div className="space-y-1 text-sm">
              <label htmlFor="category-data-observed-to" className="font-medium">
                Observed to
              </label>
              <Input
                id="category-data-observed-to"
                type="date"
                value={search.to ?? ""}
                onChange={(event) => updateSearch({ to: event.target.value || undefined })}
              />
            </div>
            <div className="space-y-1 text-sm">
              <span className="font-medium">Observation order</span>
              <Button
                type="button"
                variant="outline"
                className="w-full justify-between"
                onClick={() => updateSearch({ sort: search.sort === "asc" ? "desc" : "asc" })}
              >
                {search.sort === "asc" ? "Oldest first" : "Newest first"}
                <ArrowUpDown />
              </Button>
            </div>
          </div>

          {countQuery.isLoading || recordsQuery.isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : countQuery.isError || recordsQuery.isError ? (
            <p className="rounded-md border border-destructive/50 p-3 text-sm text-destructive">
              Could not load the custom-data history.
            </p>
          ) : count === 0 ? (
            <p className="rounded-md border border-dashed p-5 text-center text-sm text-muted-foreground">
              No records were saved with schema version {selectedVersion} for the selected date range.
            </p>
          ) : (
            <>
              <div className="min-w-0 max-w-full">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="sticky left-0 z-10 bg-muted">Observed</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>Schema</TableHead>
                      {properties.map(([name, schema]) => (
                        <TableHead key={name}>{schema.title ?? name}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recordsQuery.data?.data.map((record) => (
                      <TableRow key={record.id}>
                        <TableCell className="sticky left-0 z-10 bg-card font-medium">
                          {formatTimestamp(record.observed_at)}
                        </TableCell>
                        <TableCell>{record.source || "—"}</TableCell>
                        <TableCell>
                          <Badge variant="secondary">v{record.schema_version}</Badge>
                        </TableCell>
                        {properties.map(([name, schema]) => (
                          <TableCell key={name} className="max-w-80">
                            {formatSchemaValue(record.data?.[name], schema)}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
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
