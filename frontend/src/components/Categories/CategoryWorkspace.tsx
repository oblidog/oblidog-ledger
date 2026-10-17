import type { ColumnDef } from "@tanstack/react-table"
import { ArrowDownUp, Search } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import type { CategoryPublic } from "@/client"
import {
  DataTable,
  type DataTableFeatures,
} from "@/components/Common/DataTable"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { CounterpartyLogo } from "@/features/counterparties/CounterpartyLogo"
import { domainLabel } from "@/i18n/domainLabels"

import { CategoryActions } from "./CategoryActions"
import { CreateGroupDialog, ManageGroupsDialog } from "./CategoryGroupDialogs"
import { CreateCategoryDialog } from "./CreateCategoryDialog"
import { categoryCounterparty } from "./categoryPresentation"
import {
  useCategoryArchiveActions,
  useCategoryQueries,
} from "./useCategoryWorkspaceData"

type CategoryRow = CategoryPublic & { groupName: string }
const FILTER_ALL = "all"

export function CategoryWorkspace({ ledgerId }: { ledgerId: string }) {
  const { t } = useTranslation(["common", "app"])

  const initialFilters = () => {
    if (typeof window === "undefined") {
      return {
        group: FILTER_ALL,
        query: "",
        status: "active",
        sort: "name",
      }
    }
    const params = new URLSearchParams(window.location.search)
    return {
      group: params.get("group") || FILTER_ALL,
      query: params.get("q") || "",
      status: params.get("status") || "active",
      sort: params.get("sort") || "name",
    }
  }
  const [filters] = useState(initialFilters)
  const [groupFilter, setGroupFilter] = useState(filters.group)
  const [query, setQuery] = useState(filters.query)
  const [statusFilter, setStatusFilter] = useState(filters.status)
  const [sortBy, setSortBy] = useState(filters.sort)
  const includeArchived = statusFilter !== "active"
  const { categories, groups } = useCategoryQueries(ledgerId, includeArchived)
  const { archiveGroup, archiveCategory, restoreCategory } =
    useCategoryArchiveActions(ledgerId)

  useEffect(() => {
    if (typeof window === "undefined") return
    const params = new URLSearchParams(window.location.search)
    const values = {
      group: groupFilter,
      q: query,
      status: statusFilter,
      sort: sortBy,
    }
    Object.entries(values).forEach(([key, value]) => {
      if (
        !value ||
        (key === "group" && value === FILTER_ALL) ||
        (key === "status" && value === "active") ||
        (key === "sort" && value === "name")
      ) {
        params.delete(key)
      } else {
        params.set(key, value)
      }
    })
    const search = params.toString()
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${search ? `?${search}` : ""}`,
    )
  }, [groupFilter, query, sortBy, statusFilter])

  const rows = useMemo(() => {
    const groupNames = new Map(groups.map((group) => [group.id, group.name]))
    const normalizedQuery = query.trim().toLocaleLowerCase()
    return categories
      .filter(
        (category) =>
          groupFilter === FILTER_ALL ||
          category.category_group_id === groupFilter,
      )
      .filter(
        (category) =>
          statusFilter === FILTER_ALL ||
          (statusFilter === "active"
            ? category.is_active
            : !category.is_active),
      )
      .filter(
        (category) =>
          !normalizedQuery ||
          `${category.name} ${category.code}`
            .toLocaleLowerCase()
            .includes(normalizedQuery),
      )
      .map((category) => ({
        ...category,
        groupName:
          groupNames.get(category.category_group_id) ||
          t("app:categories.unknown_group"),
      }))
      .sort((left, right) => {
        const result = (
          sortBy === "group" ? left.groupName : left.name
        ).localeCompare(sortBy === "group" ? right.groupName : right.name)
        return result || left.name.localeCompare(right.name)
      })
  }, [categories, groupFilter, groups, query, sortBy, statusFilter, t])

  const columns = useMemo<ColumnDef<DataTableFeatures, CategoryRow>[]>(
    () => [
      {
        accessorKey: "name",
        header: () => (
          <Button variant="ghost" size="sm" onClick={() => setSortBy("name")}>
            {t("app:categories.name")} <ArrowDownUp />
          </Button>
        ),
        cell: ({ row }) => (
          <div>
            <p
              className={
                !row.original.is_active
                  ? "font-medium text-muted-foreground line-through"
                  : "font-medium"
              }
            >
              {row.original.name}
            </p>
            <div className="mt-1 flex max-w-56 items-center gap-2 text-sm text-muted-foreground">
              <CounterpartyLogo
                counterparty={categoryCounterparty(row.original)}
                className="size-5"
              />
              <span
                className="truncate"
                title={categoryCounterparty(row.original)?.name}
              >
                {categoryCounterparty(row.original)?.name ||
                  t("app:categories.not_assigned")}
              </span>
            </div>
            {row.original.description && (
              <p className="max-w-56 truncate text-sm text-muted-foreground">
                {row.original.description}
              </p>
            )}
          </div>
        ),
      },
      {
        accessorKey: "groupName",
        header: () => (
          <Button variant="ghost" size="sm" onClick={() => setSortBy("group")}>
            {t("app:categories.group")} <ArrowDownUp />
          </Button>
        ),
        cell: ({ row }) => (
          <Badge variant="outline">{row.original.groupName}</Badge>
        ),
      },
      {
        accessorKey: "code",
        header: t("app:categories.code"),
        cell: ({ row }) => (
          <Badge variant="secondary">{row.original.code}</Badge>
        ),
      },
      {
        accessorKey: "data_source_policy",
        header: t("app:categories.mode"),
        cell: ({ row }) =>
          domainLabel("categoryMode", row.original.data_source_policy),
      },
      {
        id: "recurrence",
        header: t("app:categories.recurrence"),
        cell: ({ row }) =>
          row.original.recurrence_interval && row.original.recurrence_unit
            ? t(
                row.original.recurrence_unit === "year"
                  ? "app:messages.years"
                  : "app:messages.months",
                { count: row.original.recurrence_interval },
              )
            : t("app:categories.none"),
      },
      { accessorKey: "currency", header: t("app:categories.currency") },
      {
        id: "status",
        header: t("app:categories.status"),
        cell: ({ row }) => (
          <Badge variant={row.original.is_active ? "outline" : "secondary"}>
            {row.original.is_active
              ? t("app:categories.active_a733b8")
              : t("app:categories.archived")}
          </Badge>
        ),
      },
      {
        id: "actions",
        header: t("app:categories.actions"),
        cell: ({ row }) => (
          <CategoryActions
            ledgerId={ledgerId}
            category={row.original}
            groups={groups}
            onArchive={(categoryId) => archiveCategory.mutate(categoryId)}
            onRestore={(categoryId) => restoreCategory.mutate(categoryId)}
          />
        ),
      },
    ],
    [archiveCategory, groups, ledgerId, restoreCategory, t],
  )

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>{t("app:categories.categories")}</CardTitle>
            <CardDescription>
              {t(
                "app:categories.search_filter_and_manage_categories_without_leaving_this_page",
              )}
            </CardDescription>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <CreateGroupDialog ledgerId={ledgerId} />
            <ManageGroupsDialog
              ledgerId={ledgerId}
              groups={groups}
              categories={categories}
              onArchive={(groupId) => archiveGroup.mutate(groupId)}
            />
            <CreateCategoryDialog ledgerId={ledgerId} groups={groups} />
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_160px]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="pl-9"
                placeholder={t("app:categories.search_name_or_code")}
              />
            </div>
            <Select value={groupFilter} onValueChange={setGroupFilter}>
              <SelectTrigger>
                <SelectValue placeholder={t("app:categories.all_groups")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={FILTER_ALL}>
                  {t("app:categories.all_groups")}
                </SelectItem>
                {groups.map((group) => (
                  <SelectItem key={group.id} value={group.id}>
                    {group.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">
                  {t("app:categories.active_a733b8")}
                </SelectItem>
                <SelectItem value="archived">
                  {t("app:categories.archived")}
                </SelectItem>
                <SelectItem value={FILTER_ALL}>
                  {t("app:categories.all_statuses")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DataTable columns={columns} data={rows} />
        </CardContent>
      </Card>
    </div>
  )
}

export default CategoryWorkspace
