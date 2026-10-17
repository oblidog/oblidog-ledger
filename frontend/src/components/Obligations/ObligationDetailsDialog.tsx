import { Ban, CircleCheck, CreditCard, Pencil, RotateCcw } from "lucide-react"
import { useTranslation } from "react-i18next"
import type { ObligationPublic } from "@/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { CounterpartyLogo } from "@/features/counterparties/CounterpartyLogo"
import { i18n } from "@/i18n"
import { domainLabel } from "@/i18n/domainLabels"
import { formatAmount, formatDate } from "@/i18n/format"
import { ObligationActionHistory } from "./ObligationActionHistory"
import { ObligationComponentsSection } from "./ObligationComponentsSection"
import { ObligationFieldDetails } from "./ObligationFieldDetails"
import {
  canCancelObligation,
  canEditObligation,
  canMarkObligationPaid,
  canMarkObligationReady,
  canReopenObligation,
} from "./obligationLogic"
import {
  counterpartyFor,
  sourceBadgeClasses,
  touchDialogClasses,
} from "./obligationPresentation"
import { useObligationDetail } from "./obligationQueries"
import type { useObligationActions } from "./useObligationActions"

export function ObligationDetailsDialog({
  ledgerId,
  selectedKey,
  setSelectedKey,
  canEdit,
  actions,
  setPaymentConfirmation,
  setEditingObligation,
}: {
  ledgerId: string
  selectedKey: string | null
  setSelectedKey: (key: string | null) => void
  canEdit: boolean
  actions: ReturnType<typeof useObligationActions>
  setPaymentConfirmation: (value: ObligationPublic | null) => void
  setEditingObligation: (value: ObligationPublic | null) => void
}) {
  useTranslation()
  const selected = useObligationDetail(ledgerId, selectedKey)
  const {
    actionPending,
    runAction,
    markReady,
    cancel,
    reopen,
    showErrorToast,
    showSuccessToast,
  } = actions
  return (
    <Dialog
      open={selectedKey !== null}
      onOpenChange={(open) => !open && setSelectedKey(null)}
    >
      <DialogContent
        className={`flex max-h-[min(90dvh,calc(100vh-2rem))] min-w-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl ${touchDialogClasses}`}
      >
        <DialogHeader className="shrink-0 border-b px-4 py-4 pr-12 text-left sm:px-6">
          <DialogTitle className="break-all">
            {selected.data?.key ?? i18n.t("app:obligations.obligation")}
          </DialogTitle>
          <DialogDescription>
            {i18n.t("app:obligations.obligation_details")}
          </DialogDescription>
        </DialogHeader>
        {selected.data ? (
          <Tabs
            key={selected.data.key}
            defaultValue="details"
            className="min-h-0 min-w-0 flex-1 gap-0"
          >
            <TabsList className="mx-4 my-3 h-14 w-fit max-w-[calc(100%-2rem)] shrink-0 sm:mx-6">
              <TabsTrigger value="details">
                {i18n.t("app:obligations.details")}
              </TabsTrigger>
              <TabsTrigger value="components">
                {i18n.t("app:obligations.components")}
              </TabsTrigger>
              <TabsTrigger value="activity">
                {i18n.t("app:obligations.activity")}
              </TabsTrigger>
            </TabsList>
            <TabsContent
              value="details"
              className="min-h-0 min-w-0 overflow-x-hidden overflow-y-auto px-4 pb-4 text-sm sm:px-6"
            >
              <div className="min-w-0 space-y-4">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">
                      {i18n.t("app:obligations.lifecycle")}
                    </span>
                    <Badge variant="secondary">
                      {domainLabel("lifecycle", selected.data.lifecycle)}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">
                      {i18n.t("app:obligations.effective_value_source")}
                    </span>
                    <Badge
                      variant="outline"
                      className={
                        sourceBadgeClasses[
                          selected.data.effective_value_source
                        ] ?? sourceBadgeClasses.unknown
                      }
                    >
                      {domainLabel(
                        "source",
                        selected.data.effective_value_source,
                      )}
                    </Badge>
                  </div>
                </div>
                <div className="flex items-center gap-3 rounded-lg border p-3">
                  <CounterpartyLogo
                    counterparty={counterpartyFor(selected.data) ?? null}
                  />
                  <div className="min-w-0">
                    <p className="text-xs font-medium uppercase text-muted-foreground">
                      {i18n.t("app:obligations.counterparty")}
                    </p>
                    <p className="truncate font-medium">
                      {counterpartyFor(selected.data)?.short_name ||
                        counterpartyFor(selected.data)?.name ||
                        i18n.t("app:obligations.not_assigned")}
                    </p>
                  </div>
                </div>
                {selected.data.notes ? (
                  <div className="space-y-1">
                    <p className="text-muted-foreground font-medium">
                      {i18n.t("app:obligations.notes")}
                    </p>
                    <p className="whitespace-pre-wrap break-words">
                      {selected.data.notes}
                    </p>
                  </div>
                ) : null}
                <div className="overflow-x-auto">
                  <table className="block w-full text-left text-sm md:table">
                    <thead className="hidden text-muted-foreground border-b text-xs uppercase md:table-header-group">
                      <tr>
                        <th className="pb-2 pr-4 font-medium">
                          {i18n.t("app:obligations.field")}
                        </th>
                        <th className="pb-2 pr-4 font-medium">
                          {i18n.t("app:obligations.value")}
                        </th>
                        <th className="pb-2 pr-4 font-medium">
                          {i18n.t("app:obligations.status")}
                        </th>
                        <th className="pb-2 font-medium">
                          {i18n.t("app:obligations.source_6da13a")}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="block space-y-3 md:table-row-group md:space-y-0">
                      <ObligationFieldDetails
                        label={i18n.t("app:obligations.current_amount")}
                        value={
                          selected.data.current_amount === null
                            ? i18n.t("app:obligations.unknown")
                            : formatAmount(
                                String(selected.data.current_amount),
                                selected.data.currency,
                              )
                        }
                        state={selected.data.amount_state}
                        source={selected.data.amount_source}
                      />
                      <ObligationFieldDetails
                        label={i18n.t("app:obligations.issue_date")}
                        value={
                          selected.data.issue_date
                            ? formatDate(selected.data.issue_date)
                            : i18n.t("app:obligations.unknown")
                        }
                        state={selected.data.issue_date_state}
                        source={selected.data.issue_date_source}
                      />
                      <ObligationFieldDetails
                        label={i18n.t("app:obligations.due_date")}
                        value={
                          selected.data.due_date
                            ? formatDate(selected.data.due_date)
                            : i18n.t("app:obligations.unknown")
                        }
                        state={selected.data.due_date_state}
                        source={selected.data.due_date_source}
                      />
                    </tbody>
                  </table>
                </div>
              </div>
            </TabsContent>
            <TabsContent
              value="components"
              className="min-h-0 min-w-0 overflow-x-hidden overflow-y-auto px-4 pb-4 text-sm sm:px-6"
            >
              <ObligationComponentsSection
                ledgerId={ledgerId}
                obligationKey={selected.data.key}
                currency={selected.data.currency}
                canManage={canEdit}
                onError={showErrorToast}
                onSuccess={showSuccessToast}
              />
            </TabsContent>
            <TabsContent
              value="activity"
              className="min-h-0 min-w-0 overflow-x-hidden overflow-y-auto px-4 pb-4 text-sm sm:px-6"
            >
              <ObligationActionHistory
                ledgerId={ledgerId}
                obligationKey={selected.data.key}
              />
            </TabsContent>
          </Tabs>
        ) : (
          <div className="px-4 py-4 text-sm sm:px-6">
            {selected.isError ? (
              <>
                <p role="alert">
                  {i18n.t("app:obligations.unable_to_load_obligation_details")}
                </p>
                <Button
                  className="mt-2 min-h-11"
                  variant="outline"
                  onClick={() => void selected.refetch()}
                >
                  {i18n.t("app:obligations.try_again")}
                </Button>
              </>
            ) : (
              <p>{i18n.t("app:obligations.loading_details")}</p>
            )}
          </div>
        )}
        {selected.data && canEdit ? (
          <DialogFooter className="shrink-0 border-t px-4 py-3 sm:px-6">
            <div className="flex flex-wrap gap-2">
              {canMarkObligationReady(selected.data) ? (
                <Button
                  size="sm"
                  className="min-h-11"
                  disabled={actionPending}
                  onClick={() => void runAction(markReady, selected.data)}
                >
                  <CircleCheck />
                  {i18n.t("app:obligations.mark_as_ready")}
                </Button>
              ) : null}
              {canCancelObligation(selected.data) ? (
                <Button
                  variant="destructive"
                  size="sm"
                  className="min-h-11"
                  disabled={actionPending}
                  onClick={() => void runAction(cancel, selected.data)}
                >
                  <Ban />
                  {i18n.t("app:obligations.cancel")}
                </Button>
              ) : null}
              {canMarkObligationPaid(selected.data) ? (
                <Button
                  size="sm"
                  className="min-h-11"
                  disabled={actionPending}
                  onClick={() => setPaymentConfirmation(selected.data)}
                >
                  <CreditCard />
                  {i18n.t("app:obligations.mark_as_paid")}
                </Button>
              ) : null}
              {canReopenObligation(selected.data) ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-11"
                  disabled={actionPending}
                  onClick={() => void runAction(reopen, selected.data)}
                >
                  <RotateCcw />
                  {i18n.t("app:obligations.reopen")}
                </Button>
              ) : null}
              {canEditObligation(selected.data) ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-11"
                  disabled={actionPending}
                  onClick={() => setEditingObligation(selected.data)}
                >
                  <Pencil />
                  {i18n.t("app:obligations.edit_530164")}
                </Button>
              ) : null}
            </div>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
