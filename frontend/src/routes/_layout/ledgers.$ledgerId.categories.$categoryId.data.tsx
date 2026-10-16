// @ts-nocheck

import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link, notFound } from "@tanstack/react-router"
import { ArrowLeft, ArrowUpDown, Database, ListPlus } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import {
  ApiError,
  CategoriesService,
  type CategoryDataRecordPublic,
  type CategoryDataSchemaPublic,
  client,
} from "@/client"
import { CategoryDataCsvExportButton } from "@/components/Categories/CategoryDataCsvExportButton"
import {
  buildPreviousRecordMap,
  CategoryDataDifferenceValue,
} from "@/components/Categories/CategoryDataDifference"
import {
  type CategoryDataPropertySchema,
  formatCategoryDataValue,
} from "@/components/Categories/CategoryDataValue"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
import { i18n } from "@/i18n"

const PAGE_SIZE = 20

type CategoryDataSchemasResponse = {
  data: CategoryDataSchemaPublic[]
  count: number
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
  head: () => ({
    meta: [{ title: i18n.t("app:categories.category_data_oblidog") }],
  }),
})

function dateStart(value?: string) {
  return value ? new Date(`${value}T00:00:00`).toISOString() : undefined
}

function dateEnd(value?: string) {
  return value ? new Date(`${value}T23:59:59.999`).toISOString() : undefined
}

async function readCategoryDataSchemas(ledgerId: string, categoryId: string) {
  const response = await client.get({
    responseType: "json",
    security: [
      {
        key: "OAuth2PasswordBearer",
        scheme: "bearer",
        type: "http",
      },
    ],
    throwOnError: true,
    url: "/api/v1/ledgers/{ledger_id}/categories/{category_id}/data-schemas",
    path: {
      ledger_id: ledgerId,
      category_id: categoryId,
    },
  })

  return response.data as CategoryDataSchemasResponse
}

function CategoryDataHistory() {
  useTranslation()

  const { ledgerId, categoryId } = Route.useParams()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const [page, setPage] = useState(0)
  const [showDifferences, setShowDifferences] = useState(true)

  const categoriesQuery = useQuery({
    queryFn: () =>
      CategoriesService.readCategories({ ledgerId, includeArchived: true }),
    queryKey: ["categories", ledgerId, true],
    retry: false,
  })
  const category = categoriesQuery.data?.data.find(
    (item) => item.id === categoryId,
  )

  const schemasQuery = useQuery({
    queryFn: () => readCategoryDataSchemas(ledgerId, categoryId),
    queryKey: ["category-data-schemas", ledgerId, categoryId],
    enabled: categoriesQuery.isSuccess && Boolean(category),
    retry: false,
  })

  const activeSchema = schemasQuery.data?.data.find(
    (schema) => schema.is_active,
  )
  const selectedVersion = search.schema ?? activeSchema?.version
  const selectedSchema = schemasQuery.data?.data.find(
    (schema) => schema.version === selectedVersion,
  )

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
  const pageItemCount = Math.min(
    PAGE_SIZE,
    Math.max(0, count - page * PAGE_SIZE),
  )
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
        // The extra, older record is comparison context for the final visible
        // row. It is never rendered as part of the current page.
        limit: pageItemCount + 1,
        offset,
      })
      const recordsNewestFirst = response.data as CategoryDataRecordPublic[]
      const previousByRecordId = buildPreviousRecordMap(recordsNewestFirst)
      const visibleRecords = recordsNewestFirst.slice(0, pageItemCount)

      return {
        ...response,
        data:
          search.sort === "asc"
            ? [...visibleRecords].reverse()
            : visibleRecords,
        previousByRecordId,
      }
    },
    enabled: Boolean(selectedSchema) && countQuery.isSuccess,
    retry: false,
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
          {i18n.t("app:categories.could_not_load_the_selected_category_data")}
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
            <ArrowLeft /> {i18n.t("app:categories.back_to_categories")}
          </Link>
        </Button>
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          {i18n.t(
            "app:categories.no_custom_data_schema_is_available_for_this_category",
          )}
        </p>
      </div>
    )
  }

  const properties = Object.entries(
    selectedSchema.schema?.properties ?? {},
  ) as [string, CategoryDataPropertySchema][]
  const pageStart = count === 0 ? 0 : page * PAGE_SIZE + 1
  const pageEnd = Math.min((page + 1) * PAGE_SIZE, count)
  const canGoNext = pageEnd < count

  const updateSearch = (patch: Record<string, unknown>) => {
    setPage(0)
    navigate({ search: (current) => ({ ...current, ...patch }), replace: true })
  }

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-6xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" size="sm" className="w-fit" asChild>
          <Link to="/ledgers/$ledgerId/categories" params={{ ledgerId }}>
            <ArrowLeft />
            {i18n.t("app:categories.back_to_categories")}
          </Link>
        </Button>
        <div className="flex flex-wrap gap-2">
          <CategoryDataCsvExportButton
            ledgerId={ledgerId}
            categoryId={categoryId}
            schemaVersion={selectedVersion}
            observedFrom={queryFilters.observedFrom}
            observedTo={queryFilters.observedTo}
          />
          <Button variant="outline" size="sm" asChild>
            <Link
              to="/ledgers/$ledgerId/categories/$categoryId/custom-fields"
              params={{ ledgerId, categoryId }}
            >
              <ListPlus />
              {i18n.t("app:categories.manage_custom_fields")}
            </Link>
          </Button>
        </div>
      </div>

      <Card className="min-w-0">
        <CardHeader>
          <div className="mb-2 flex items-center gap-2">
            <Database className="size-5 text-primary" />
          </div>
          <h1 className="leading-none font-semibold">
            {i18n.t("app:categories.custom_data_history_for")} {category.name}
          </h1>
          <CardDescription>
            {countQuery.isLoading
              ? i18n.t("app:categories.loading_records")
              : i18n.t("app:messages.schema_records", {
                  count,
                  version: selectedVersion,
                })}
          </CardDescription>
        </CardHeader>
        <CardContent className="min-w-0 space-y-5">
          <div className="grid gap-3 md:grid-cols-5">
            <div className="space-y-1 text-sm">
              <span className="font-medium">
                {i18n.t("app:categories.schema_version")}
              </span>
              <Select
                value={String(selectedVersion)}
                onValueChange={(value) =>
                  updateSearch({ schema: Number(value) })
                }
              >
                <SelectTrigger
                  className="w-full"
                  aria-label={i18n.t("app:categories.schema_version")}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {schemasQuery.data?.data.map((schema) => (
                    <SelectItem
                      key={schema.version}
                      value={String(schema.version)}
                    >
                      {i18n.t("app:categories.version")} {schema.version}
                      {schema.is_active
                        ? i18n.t("app:categories.active_506950")
                        : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 text-sm">
              <label
                htmlFor="category-data-observed-from"
                className="font-medium"
              >
                {i18n.t("app:categories.observed_from")}
              </label>
              <Input
                id="category-data-observed-from"
                type="date"
                value={search.from ?? ""}
                onChange={(event) =>
                  updateSearch({ from: event.target.value || undefined })
                }
              />
            </div>
            <div className="space-y-1 text-sm">
              <label
                htmlFor="category-data-observed-to"
                className="font-medium"
              >
                {i18n.t("app:categories.observed_to")}
              </label>
              <Input
                id="category-data-observed-to"
                type="date"
                value={search.to ?? ""}
                onChange={(event) =>
                  updateSearch({ to: event.target.value || undefined })
                }
              />
            </div>
            <div className="space-y-1 text-sm">
              <span className="font-medium">
                {i18n.t("app:categories.observation_order")}
              </span>
              <Button
                type="button"
                variant="outline"
                className="w-full justify-between"
                onClick={() =>
                  updateSearch({ sort: search.sort === "asc" ? "desc" : "asc" })
                }
              >
                {search.sort === "asc"
                  ? i18n.t("app:categories.oldest_first")
                  : i18n.t("app:categories.newest_first")}
                <ArrowUpDown />
              </Button>
            </div>
            <div className="flex items-end pb-2">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="show-category-data-differences"
                  checked={showDifferences}
                  onCheckedChange={(checked) =>
                    setShowDifferences(checked === true)
                  }
                />
                <Label htmlFor="show-category-data-differences">
                  {i18n.t("app:categories.show_differences")}
                </Label>
              </div>
            </div>
          </div>

          {countQuery.isLoading || recordsQuery.isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : countQuery.isError || recordsQuery.isError ? (
            <p className="rounded-md border border-destructive/50 p-3 text-sm text-destructive">
              {i18n.t("app:categories.could_not_load_the_custom_data_history")}
            </p>
          ) : count === 0 ? (
            <p className="rounded-md border border-dashed p-5 text-center text-sm text-muted-foreground">
              {i18n.t(
                "app:categories.no_records_were_saved_with_schema_version",
              )}{" "}
              {selectedVersion}{" "}
              {i18n.t("app:categories.for_the_selected_date_range")}
            </p>
          ) : (
            <>
              <div className="min-w-0 max-w-full">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="sticky left-0 z-10 bg-muted">
                        {i18n.t("app:categories.observed")}
                      </TableHead>
                      <TableHead>{i18n.t("app:categories.source")}</TableHead>
                      <TableHead>{i18n.t("app:categories.schema")}</TableHead>
                      {properties.map(([name, schema]) => (
                        <TableHead key={name}>{schema.title ?? name}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recordsQuery.data?.data.map((record) => (
                      <TableRow
                        key={record.id}
                        data-testid={`category-data-row-${record.id}`}
                      >
                        <TableCell className="sticky left-0 z-10 bg-card font-medium">
                          {formatCategoryDataValue(record.observed_at, {
                            type: "string",
                            format: "date-time",
                          })}
                        </TableCell>
                        <TableCell>{record.source || "—"}</TableCell>
                        <TableCell>
                          <Badge variant="secondary">
                            v{record.schema_version}
                          </Badge>
                        </TableCell>
                        {properties.map(([name, schema]) => (
                          <TableCell key={name} className="max-w-80">
                            <CategoryDataDifferenceValue
                              currentData={record.data}
                              previousData={
                                recordsQuery.data?.previousByRecordId.get(
                                  record.id,
                                )?.data
                              }
                              propertyName={name}
                              schema={schema}
                              showDifferences={showDifferences}
                            />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                <p className="text-sm text-muted-foreground">
                  {i18n.t("app:categories.showing")} {pageStart}–{pageEnd}{" "}
                  {i18n.t("app:categories.of")} {count}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setPage((current) => Math.max(0, current - 1))
                    }
                    disabled={page === 0 || recordsQuery.isFetching}
                  >
                    {i18n.t("app:categories.previous_50f942")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((current) => current + 1)}
                    disabled={!canGoNext || recordsQuery.isFetching}
                  >
                    {i18n.t("app:categories.next")}
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
