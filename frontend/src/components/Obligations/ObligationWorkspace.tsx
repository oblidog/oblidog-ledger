import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import type { ObligationPublic } from "@/client"
import {
  type ActiveFilter,
  ActiveFilterBadges,
} from "@/components/ActiveFilterBadges"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { i18n } from "@/i18n"
import { CreateObligationDialog } from "./CreateObligationDialog"
import { EditObligationDialog } from "./EditObligationDialog"
import { ObligationDetailsDialog } from "./ObligationDetailsDialog"
import { ObligationPaymentDialog } from "./ObligationPaymentDialog"
import { ObligationTile } from "./ObligationTile"
import {
  isValidPeriod,
  type LifecycleFilter,
  lifecycleFilterLabel,
  lifecycleOptions,
  monthInputValue,
  parseMonthInput,
  parseObligationFilters,
  serializeObligationFilters,
} from "./obligationLogic"
import {
  periodFromSearch,
  visibleObligationRows,
} from "./obligationPresentation"
import { useObligationList } from "./obligationQueries"
import { useObligationActions } from "./useObligationActions"

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
  const initialFilters = parseObligationFilters(
    typeof window === "undefined" ? "" : window.location.search,
    defaultLifecycle,
    period,
  )
  const [year, setYear] = useState(initialFilters.year)
  const [month, setMonth] = useState(initialFilters.month)
  const [filterByPeriod, setFilterByPeriod] = useState(
    initialFilters.filterByPeriod,
  )
  const [categoryCode, setCategoryCode] = useState(initialFilters.categoryCode)
  const [lifecycle, setLifecycle] = useState<LifecycleFilter>(
    initialFilters.lifecycle,
  )
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

  useEffect(() => {
    if (typeof window === "undefined") return

    const search = serializeObligationFilters(window.location.search, {
      year,
      month,
      filterByPeriod,
      categoryCode,
      lifecycle,
    })
    const nextUrl = `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`
    window.history.replaceState(window.history.state, "", nextUrl)
  }, [categoryCode, filterByPeriod, month, year, lifecycle])

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
  const activeFilters: ActiveFilter[] = []
  if (filterByPeriod && hasValidPeriodFilter) {
    activeFilters.push({
      key: "period",
      label: i18n.t("app:messages.filter_period", {
        value: monthInputValue(year, month),
      }),
      onRemove: () => setFilterByPeriod(false),
    })
  }
  if (categoryCode) {
    activeFilters.push({
      key: "category",
      label: i18n.t("app:messages.filter_category", { value: categoryCode }),
      onRemove: () => setCategoryCode(""),
    })
  }
  if (lifecycle) {
    activeFilters.push({
      key: "lifecycle",
      label: i18n.t("app:messages.filter_status", {
        value: lifecycleFilterLabel(lifecycle),
      }),
      onRemove: () => setLifecycle(""),
    })
  }
  const clearFilters = () => {
    setFilterByPeriod(false)
    setCategoryCode("")
    setLifecycle("")
  }

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
          <Input
            aria-label={i18n.t("app:obligations.billing_period")}
            type="month"
            disabled={!filterByPeriod}
            value={monthInputValue(year, month)}
            onChange={(event) => {
              const selectedPeriod = parseMonthInput(event.target.value)
              setYear(selectedPeriod?.year ?? "")
              setMonth(selectedPeriod?.month ?? "")
            }}
          />
          <Input
            aria-label={i18n.t("app:obligations.category_code")}
            placeholder={i18n.t("app:obligations.category_code")}
            value={categoryCode}
            maxLength={4}
            onChange={(event) =>
              setCategoryCode(event.target.value.toUpperCase())
            }
          />
          <select
            aria-label={i18n.t("app:obligations.lifecycle")}
            className="border-input bg-background text-foreground h-9 rounded-md border px-3 text-sm"
            value={lifecycle}
            onChange={(event) =>
              setLifecycle(event.target.value as LifecycleFilter)
            }
          >
            {lifecycleOptions.map((option) => (
              <option
                key={option || "all"}
                value={option}
                className="bg-background text-foreground"
              >
                {option === ""
                  ? i18n.t("app:obligations.all_lifecycles")
                  : option === "unpaid"
                    ? i18n.t("app:obligations.unpaid")
                    : option}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id="obligation-filter-by-period"
            checked={filterByPeriod}
            onCheckedChange={(checked) => setFilterByPeriod(checked === true)}
          />
          <Label htmlFor="obligation-filter-by-period">
            {i18n.t("app:obligations.filter_by_period")}
          </Label>
        </div>
        <ActiveFilterBadges filters={activeFilters} onClearAll={clearFilters} />
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
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {!obligations.isError
            ? visibleObligations?.map((obligation) => (
                <ObligationTile
                  key={obligation.key}
                  ledgerId={ledgerId}
                  obligation={obligation}
                  canWrite={canEdit}
                  disabled={actionPending}
                  loading={pendingActionKey === obligation.key}
                  onEdit={() => setEditingObligation(obligation)}
                  onCancel={() => void runAction(cancel, obligation)}
                  onMarkPaid={() => setPaymentConfirmation(obligation)}
                  onMarkReady={() => void runAction(markReady, obligation)}
                  onReopen={() => void runAction(reopen, obligation)}
                  onSelect={() => setSelectedKey(obligation.key)}
                />
              ))
            : null}
        </div>
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
