import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { CategoriesService, type ObligationPublic } from "@/client"
import {
  type ActiveFilter,
  ActiveFilterBadges,
} from "@/components/ActiveFilterBadges"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { useIsMobile } from "@/hooks/useMobile"
import { i18n } from "@/i18n"
import { CreateObligationDialog } from "./CreateObligationDialog"
import { EditObligationDialog } from "./EditObligationDialog"
import type { ObligationItemProps } from "./ObligationActions"
import { ObligationDetailsDialog } from "./ObligationDetailsDialog"
import { CategoryFilter, PeriodFilter } from "./ObligationFilters"
import { ObligationList } from "./ObligationList"
import { ObligationPaymentDialog } from "./ObligationPaymentDialog"
import { ObligationTile } from "./ObligationTile"
import {
  isValidPeriod,
  type LifecycleFilter,
  lifecycleFilterLabel,
  lifecycleOptions,
  monthInputValue,
  parseMonthInput,
} from "./obligationLogic"
import {
  periodFromSearch,
  visibleObligationRows,
} from "./obligationPresentation"
import { useObligationList } from "./obligationQueries"
import { useObligationActions } from "./useObligationActions"
import { useObligationFilters } from "./useObligationFilters"

export function ObligationWorkspace({
  ledgerId,
  canEdit,
  defaultLifecycle = "unpaid",
}: {
  ledgerId: string
  canEdit: boolean
  defaultLifecycle?: LifecycleFilter
}) {
  useTranslation()

  const period = periodFromSearch()
  const { filters, update } = useObligationFilters(defaultLifecycle)
  const { year, month, filterByPeriod, categoryCode, lifecycle } = filters
  const isMobile = useIsMobile()
  const categories = useQuery({
    queryKey: ["categories", ledgerId, "obligation-filters"],
    queryFn: () =>
      CategoriesService.readCategories({ ledgerId, includeArchived: true }),
  })
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [editingObligation, setEditingObligation] =
    useState<ObligationPublic | null>(null)
  const [paymentConfirmation, setPaymentConfirmation] =
    useState<ObligationPublic | null>(null)
  const actions = useObligationActions(
    ledgerId,
    canEdit,
    setPaymentConfirmation,
  )
  const {
    markReady,
    reopen,
    cancel,
    runAction,
    pendingActionKey,
    actionPending,
    showErrorToast,
    showSuccessToast,
  } = actions
  const filterYear = Number(year)
  const filterMonth = Number(month)
  const hasValidPeriodFilter =
    !filterByPeriod || isValidPeriod(filterYear, filterMonth)

  const obligations = useObligationList(
    ledgerId,
    filterByPeriod,
    year,
    month,
    categoryCode,
    lifecycle,
  )
  const visibleObligations = visibleObligationRows(
    obligations.data?.data,
    lifecycle,
  )
  const clearFilters = () =>
    update({ filterByPeriod: false, categoryCode: "", lifecycle: "" })
  const activeFilters: ActiveFilter[] = []
  if (categoryCode) {
    const categoryName =
      categories.data?.data.find((category) => category.code === categoryCode)
        ?.name ?? categoryCode
    activeFilters.push({
      key: "category",
      label: i18n.t("app:messages.filter_category", { value: categoryName }),
      onRemove: () => update({ categoryCode: "" }),
    })
  }
  if (lifecycle) {
    activeFilters.push({
      key: "lifecycle",
      label: i18n.t("app:messages.filter_status", {
        value: lifecycleFilterLabel(lifecycle),
      }),
      onRemove: () => update({ lifecycle: "" }),
    })
  }
  const items: ObligationItemProps[] = !obligations.isError
    ? (visibleObligations?.map((obligation) => ({
        ledgerId,
        obligation,
        canWrite: canEdit,
        disabled: actionPending,
        loading: pendingActionKey === obligation.key,
        onEdit: () => setEditingObligation(obligation),
        onCancel: () => void runAction(cancel, obligation),
        onMarkPaid: () => setPaymentConfirmation(obligation),
        onMarkReady: () => void runAction(markReady, obligation),
        onReopen: () => void runAction(reopen, obligation),
        onSelect: () => setSelectedKey(obligation.key),
      })) ?? [])
    : []

  return (
    <section className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold md:text-2xl">
            {i18n.t("app:obligations.obligations")}
          </h1>
          <p className="mt-1 hidden text-sm text-muted-foreground md:block">
            {i18n.t(
              "app:obligations.review_and_add_manual_obligations_for_this_ledger",
            )}
          </p>
        </div>
        {canEdit ? (
          <CreateObligationDialog
            ledgerId={ledgerId}
            defaultPeriod={
              filterByPeriod && hasValidPeriodFilter
                ? { year: filterYear, month: filterMonth }
                : period
            }
            onError={showErrorToast}
            onSuccess={showSuccessToast}
          />
        ) : null}
      </div>
      <div className="mt-4 space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="min-w-0 space-y-1.5">
            <Label>{i18n.t("app:obligations.billing_period")}</Label>
            <PeriodFilter
              key={filterByPeriod ? monthInputValue(year, month) : "all"}
              value={filterByPeriod ? monthInputValue(year, month) : ""}
              onChange={(value) => {
                const selected = parseMonthInput(value)
                update(
                  selected
                    ? {
                        year: selected.year,
                        month: selected.month,
                        filterByPeriod: true,
                      }
                    : { filterByPeriod: false },
                )
              }}
            />
          </div>
          <div className="min-w-0 space-y-1.5">
            <Label>{i18n.t("app:obligations.category_filter")}</Label>
            <CategoryFilter
              categories={categories.data?.data ?? []}
              value={categoryCode}
              onChange={(code) => update({ categoryCode: code })}
              unavailable={categories.isError}
            />
          </div>
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="obligation-lifecycle-filter">
              {i18n.t("app:obligations.status")}
            </Label>
            <select
              id="obligation-lifecycle-filter"
              aria-label={i18n.t("app:obligations.lifecycle")}
              className="border-input bg-background text-foreground h-9 w-full rounded-md border px-3 text-sm"
              value={lifecycle}
              onChange={(event) =>
                update({ lifecycle: event.target.value as LifecycleFilter })
              }
            >
              {lifecycleOptions.map((option) => (
                <option key={option || "all"} value={option}>
                  {option === ""
                    ? i18n.t("app:obligations.all_lifecycles")
                    : option === "unpaid"
                      ? i18n.t("app:obligations.unpaid")
                      : lifecycleFilterLabel(option)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <ActiveFilterBadges filters={activeFilters} />
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={clearFilters}
            disabled={!filterByPeriod && !categoryCode && !lifecycle}
          >
            {i18n.t("app:filters.clear_all")}
          </Button>
        </div>
        {filterByPeriod && !hasValidPeriodFilter ? (
          <p className="text-sm text-muted-foreground">
            {i18n.t(
              "app:obligations.enter_a_valid_year_and_month_to_load_obligations",
            )}
          </p>
        ) : null}
        {hasValidPeriodFilter && obligations.isLoading ? (
          <p className="text-sm text-muted-foreground">
            {i18n.t("app:obligations.loading_obligations")}
          </p>
        ) : null}
        {hasValidPeriodFilter && obligations.isError ? (
          <div className="flex items-center gap-3 text-sm text-destructive">
            <span>{i18n.t("app:obligations.unable_to_load_obligations")}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void obligations.refetch()}
            >
              {i18n.t("app:obligations.try_again")}
            </Button>
          </div>
        ) : null}
        {hasValidPeriodFilter &&
        !obligations.isError &&
        visibleObligations?.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {i18n.t("app:obligations.no_obligations_match_these_filters")}
          </p>
        ) : null}
        {items.length > 0 &&
          (isMobile ? (
            <div className="grid grid-cols-1 gap-3">
              {items.map((item) => (
                <ObligationTile key={item.obligation.key} {...item} />
              ))}
            </div>
          ) : (
            <ObligationList items={items} />
          ))}
        <ObligationDetailsDialog
          ledgerId={ledgerId}
          selectedKey={selectedKey}
          setSelectedKey={setSelectedKey}
          canEdit={canEdit}
          actions={actions}
          setPaymentConfirmation={setPaymentConfirmation}
          setEditingObligation={setEditingObligation}
        />
        <ObligationPaymentDialog
          paymentConfirmation={paymentConfirmation}
          setPaymentConfirmation={setPaymentConfirmation}
          actions={actions}
        />
        {editingObligation ? (
          <EditObligationDialog
            ledgerId={ledgerId}
            obligation={editingObligation}
            open={editingObligation !== null}
            onError={showErrorToast}
            onOpenChange={(open) => !open && setEditingObligation(null)}
            onSuccess={showSuccessToast}
          />
        ) : null}
      </div>
    </section>
  )
}
