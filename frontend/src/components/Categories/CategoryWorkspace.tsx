import type { ColumnDef } from "@tanstack/react-table"
import { ArrowDownUp, Search } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import type { CategoryPublic } from "@/client"
import {
  DataTable,
  type DataTableFeatures,
} from "@/components/Common/DataTable"
import { PageHeader } from "@/components/Common/PageHeader"
import { Button } from "@/components/ui/button"
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
import { CategoryPaymentAction } from "./CategoryPaymentAction"
import { CreateCategoryDialog } from "./CreateCategoryDialog"
import {
  categoryCounterparty,
  firstScheduledPeriod,
} from "./categoryPresentation"
import {
  useCategoryArchiveActions,
  useCategoryQueries,
} from "./useCategoryWorkspaceData"

type CategoryRow = CategoryPublic & { groupName: string }
const FILTER_ALL = "all"

export function CategoryWorkspace({
  ledgerId,
  canEdit,
  demoPreview,
}: {
  ledgerId: string
  canEdit: boolean
  demoPreview: boolean
}) {
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
  const [createdCategoryId, setCreatedCategoryId] = useState<string | null>(
    null,
  )
  const activeGroup = groups.some((group) => group.is_active)
  const activeCategory = categories.some((category) => category.is_active)
  const firstStep = canEdit && (!activeGroup || !activeCategory)
  const latestCreatedCategory = categories.find(
    (category) => category.id === createdCategoryId,
  )
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
            {row.original.id !== latestCreatedCategory?.id && (
              <div className="mt-2">
                <CategoryPaymentAction
                  category={row.original}
                  ledgerId={ledgerId}
                  groups={groups}
                  canEdit={canEdit}
                  demoPreview={demoPreview}
                />
              </div>
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
          <span className="text-muted-foreground">
            {row.original.groupName}
          </span>
        ),
      },
      {
        accessorKey: "code",
        header: t("app:categories.code"),
        cell: ({ row }) => (
          <span className="font-mono text-xs text-muted-foreground">
            {row.original.code}
          </span>
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
          firstScheduledPeriod(row.original)
            ? t(
                row.original.recurrence_unit === "year"
                  ? "app:messages.years"
                  : "app:messages.months",
                { count: row.original.recurrence_interval ?? 0 },
              )
            : t("app:categories.none"),
      },
      { accessorKey: "currency", header: t("app:categories.currency") },
      {
        id: "status",
        header: t("app:categories.status"),
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {row.original.is_active
              ? t("app:categories.active_a733b8")
              : t("app:categories.archived")}
          </span>
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
    [
      archiveCategory,
      canEdit,
      demoPreview,
      groups,
      latestCreatedCategory?.id,
      ledgerId,
      restoreCategory,
      t,
    ],
  )

  const createCategory = (
    <CreateCategoryDialog
      ledgerId={ledgerId}
      groups={groups}
      onCreated={(category) => setCreatedCategoryId(category.id)}
    />
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("app:categories.categories")}
        actions={
          canEdit && (
            <>
              {activeGroup && <CreateGroupDialog ledgerId={ledgerId} />}
              <ManageGroupsDialog
                ledgerId={ledgerId}
                groups={groups}
                categories={categories}
                onArchive={(groupId) => archiveGroup.mutate(groupId)}
              />
              {!firstStep && createCategory}
            </>
          )
        }
      />
      {firstStep && (
        <div className="space-y-3 rounded-lg border border-dashed p-4">
          <h2 className="font-semibold">
            {t(
              activeGroup
                ? "app:categories.add_first_category"
                : "app:categories.add_first_group",
            )}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t(
              activeGroup
                ? "app:categories.first_category_help"
                : "app:categories.first_group_help",
            )}
          </p>
          {activeGroup ? (
            createCategory
          ) : (
            <CreateGroupDialog ledgerId={ledgerId} />
          )}
        </div>
      )}
      {latestCreatedCategory?.is_active && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
          <p className="min-w-0 break-words text-sm">
            {t("app:categories.category_next_step", {
              name: latestCreatedCategory.name,
            })}
          </p>
          <CategoryPaymentAction
            category={latestCreatedCategory}
            ledgerId={ledgerId}
            groups={groups}
            canEdit={canEdit}
          />
        </div>
      )}
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_160px]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="pl-9"
              placeholder={t("app:categories.search_name_or_code")}
              aria-label={t("app:categories.search_name_or_code")}
            />
          </div>
          <Select value={groupFilter} onValueChange={setGroupFilter}>
            <SelectTrigger aria-label={t("app:categories.group")}>
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
            <SelectTrigger aria-label={t("app:categories.status")}>
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
        <div className="overflow-hidden rounded-lg border">
          <DataTable
            columns={
              demoPreview
                ? columns.filter((column) => column.id !== "actions")
                : columns
            }
            data={rows}
          />
        </div>
      </div>
    </div>
  )
}

export default CategoryWorkspace
