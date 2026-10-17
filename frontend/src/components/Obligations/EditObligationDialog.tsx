import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { type ObligationPublic, ObligationsService } from "@/client"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { LoadingButton } from "@/components/ui/loading-button"
import { i18n } from "@/i18n"
import { handleError } from "@/utils"
import { ObligationValueFields } from "./ObligationValueFields"
import { dueDateRange } from "./obligationLogic"
import { touchDialogClasses } from "./obligationPresentation"
import { obligationQueryKeys } from "./obligationQueries"

export function EditObligationDialog({
  ledgerId,
  obligation,
  open,
  onSuccess,
  onError,
  onOpenChange,
}: {
  ledgerId: string
  obligation: ObligationPublic
  open: boolean
  onSuccess: (message: string) => void
  onError: (message: string) => void
  onOpenChange: (open: boolean) => void
}) {
  useTranslation()

  const [currentAmount, setCurrentAmount] = useState("")
  const [issueDate, setIssueDate] = useState("")
  const [dueDate, setDueDate] = useState("")
  const [notes, setNotes] = useState("")
  const submitLock = useRef(false)
  const queryClient = useQueryClient()
  const dueDateLimits = dueDateRange(
    obligation.period.year,
    obligation.period.month,
  )
  const originalCurrentAmount = obligation.current_amount?.toString() ?? ""
  const originalIssueDate = obligation.issue_date ?? ""
  const originalDueDate = obligation.due_date ?? ""
  const originalNotes = obligation.notes ?? ""

  useEffect(() => {
    if (!open) {
      return
    }
    setCurrentAmount(originalCurrentAmount)
    setIssueDate(originalIssueDate)
    setDueDate(originalDueDate)
    setNotes(originalNotes)
  }, [
    open,
    originalCurrentAmount,
    originalDueDate,
    originalIssueDate,
    originalNotes,
  ])

  const dueDateOutOfRange =
    dueDate !== "" &&
    (dueDate < dueDateLimits.min || dueDate > dueDateLimits.max)
  const issueDateAfterDueDate =
    issueDate !== "" && dueDate !== "" && issueDate > dueDate
  const hasChanges =
    currentAmount !== originalCurrentAmount ||
    issueDate !== originalIssueDate ||
    dueDate !== originalDueDate ||
    notes !== originalNotes
  const mutation = useMutation({
    mutationFn: () => {
      const requestBody: {
        current_amount?: string | null
        issue_date?: string | null
        due_date?: string | null
        notes?: string | null
      } = {}
      if (currentAmount !== originalCurrentAmount) {
        requestBody.current_amount = currentAmount || null
      }
      if (issueDate !== originalIssueDate) {
        requestBody.issue_date = issueDate || null
      }
      if (dueDate !== originalDueDate) {
        requestBody.due_date = dueDate || null
      }
      if (notes !== originalNotes) {
        requestBody.notes = notes || null
      }
      return ObligationsService.updateObligation({
        ledgerId,
        obligationKey: obligation.key,
        requestBody,
      })
    },
    onError: handleError.bind(onError),
    onSuccess: () => {
      onSuccess(i18n.t("app:obligations.obligation_updated"))
      onOpenChange(false)
      void queryClient.invalidateQueries({
        queryKey: obligationQueryKeys.actions(ledgerId, obligation.key),
      })
      void queryClient.invalidateQueries({
        queryKey: obligationQueryKeys.detail(ledgerId, obligation.key),
      })
      void queryClient.invalidateQueries({
        queryKey: obligationQueryKeys.list(ledgerId),
      })
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={`max-h-[calc(100dvh-2rem)] overflow-y-auto ${touchDialogClasses}`}
      >
        <DialogHeader className="pr-10">
          <DialogTitle>{i18n.t("app:obligations.edit_obligation")}</DialogTitle>
          <DialogDescription>
            {i18n.t("app:obligations.update_manually_entered_values_and_notes")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <ObligationValueFields
            idPrefix="edit-obligation"
            currency={obligation.currency}
            currentAmount={currentAmount}
            setCurrentAmount={setCurrentAmount}
            issueDate={issueDate}
            setIssueDate={setIssueDate}
            dueDate={dueDate}
            setDueDate={setDueDate}
            dueDateLimits={dueDateLimits}
            notes={notes}
            setNotes={setNotes}
          />
          <LoadingButton
            className="min-h-11 w-full"
            loading={mutation.isPending}
            disabled={!hasChanges || dueDateOutOfRange || issueDateAfterDueDate}
            onClick={() => {
              if (submitLock.current) return
              submitLock.current = true
              void mutation
                .mutateAsync()
                .catch(() => {})
                .finally(() => {
                  submitLock.current = false
                })
            }}
          >
            {i18n.t("app:obligations.save_changes")}
          </LoadingButton>
        </div>
      </DialogContent>
    </Dialog>
  )
}
