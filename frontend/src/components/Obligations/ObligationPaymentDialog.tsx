import { useTranslation } from "react-i18next"
import type { ObligationPublic } from "@/client"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { LoadingButton } from "@/components/ui/loading-button"
import { i18n } from "@/i18n"
import { canMarkObligationPaid } from "./obligationLogic"

import { touchDialogClasses } from "./obligationPresentation"
import type { useObligationActions } from "./useObligationActions"

export function ObligationPaymentDialog({
  paymentConfirmation,
  setPaymentConfirmation,
  actions,
}: {
  paymentConfirmation: ObligationPublic | null
  setPaymentConfirmation: (value: ObligationPublic | null) => void
  actions: ReturnType<typeof useObligationActions>
}) {
  useTranslation()
  const { actionPending, runAction, markPaid } = actions
  return (
    <Dialog
      open={paymentConfirmation !== null}
      onOpenChange={(open) => {
        if (!open && !actionPending) setPaymentConfirmation(null)
      }}
    >
      <DialogContent
        className={touchDialogClasses}
        onEscapeKeyDown={(event) => {
          if (actionPending) event.preventDefault()
        }}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader className="pr-10">
          <DialogTitle>
            {i18n.t("app:obligations.mark_obligation_as_paid")}
          </DialogTitle>
          <DialogDescription>
            {i18n.t(
              "app:obligations.confirm_that_you_have_paid_this_obligation",
            )}
          </DialogDescription>
        </DialogHeader>
        {paymentConfirmation ? (
          <div className="min-w-0 space-y-1">
            <p className="break-words font-medium">
              {paymentConfirmation.name}
            </p>
            <p className="break-all text-sm text-muted-foreground">
              {paymentConfirmation.key}
            </p>
            <p className="text-lg font-semibold tabular-nums">
              {paymentConfirmation.current_amount}{" "}
              {paymentConfirmation.currency}
            </p>
          </div>
        ) : null}
        <DialogFooter>
          <Button
            className="min-h-11"
            variant="outline"
            disabled={actionPending}
            onClick={() => setPaymentConfirmation(null)}
          >
            {i18n.t("app:obligations.cancel")}
          </Button>
          <LoadingButton
            className="min-h-11"
            loading={actionPending}
            disabled={
              paymentConfirmation === null ||
              !canMarkObligationPaid(paymentConfirmation)
            }
            onClick={() => {
              if (
                paymentConfirmation !== null &&
                canMarkObligationPaid(paymentConfirmation) &&
                !actionPending
              ) {
                void runAction(markPaid, paymentConfirmation)
              }
            }}
          >
            {i18n.t("app:obligations.mark_as_paid")}
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
