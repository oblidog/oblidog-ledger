import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useRef, useState } from "react"
import { type ObligationPublic, ObligationsService } from "@/client"
import useCustomToast from "@/hooks/useCustomToast"
import { i18n } from "@/i18n"
import { handleError } from "@/utils"
import { invalidateObligationAction } from "./obligationQueries"

export function useObligationActions(
  ledgerId: string,
  canEdit: boolean,
  setPaymentConfirmation: (value: ObligationPublic | null) => void,
) {
  const actionLock = useRef(false)
  const [pendingActionKey, setPendingActionKey] = useState<string | null>(null)
  const actionPending = pendingActionKey !== null
  const queryClient = useQueryClient()
  const { showErrorToast, showSuccessToast } = useCustomToast()
  const markReady = useMutation({
    mutationFn: (obligation: ObligationPublic) =>
      ObligationsService.markObligationReady({
        ledgerId,
        obligationKey: obligation.key,
      }),
    onError: handleError.bind(showErrorToast),
    onSuccess: async (_, obligation) => {
      showSuccessToast(i18n.t("app:obligations.obligation_marked_as_ready"))
      await invalidateObligationAction(queryClient, ledgerId, obligation.key)
    },
  })
  const reopen = useMutation({
    mutationFn: (obligation: ObligationPublic) =>
      ObligationsService.reopenObligation({
        ledgerId,
        obligationKey: obligation.key,
      }),
    onError: handleError.bind(showErrorToast),
    onSuccess: async (_, obligation) => {
      showSuccessToast(i18n.t("app:obligations.obligation_reopened"))
      await invalidateObligationAction(queryClient, ledgerId, obligation.key)
    },
  })
  const cancel = useMutation({
    mutationFn: (obligation: ObligationPublic) =>
      ObligationsService.cancelObligation({
        ledgerId,
        obligationKey: obligation.key,
      }),
    onError: handleError.bind(showErrorToast),
    onSuccess: async (_, obligation) => {
      showSuccessToast(i18n.t("app:obligations.obligation_canceled"))
      await invalidateObligationAction(queryClient, ledgerId, obligation.key)
    },
  })
  const markPaid = useMutation({
    mutationFn: (obligation: ObligationPublic) =>
      ObligationsService.markObligationPaid({
        ledgerId,
        obligationKey: obligation.key,
      }),
    onError: handleError.bind(showErrorToast),
    onSuccess: async (_, obligation) => {
      setPaymentConfirmation(null)
      showSuccessToast(i18n.t("app:obligations.obligation_marked_as_paid"))
      await invalidateObligationAction(queryClient, ledgerId, obligation.key)
    },
  })

  const runAction = async (
    action: typeof markReady,
    obligation: ObligationPublic,
  ) => {
    if (!canEdit || actionLock.current) return
    actionLock.current = true
    setPendingActionKey(obligation.key)
    try {
      await action.mutateAsync(obligation)
    } catch {
      // The mutation reports the error; keep the current view for retry.
    } finally {
      actionLock.current = false
      setPendingActionKey(null)
    }
  }

  return {
    markReady,
    reopen,
    cancel,
    markPaid,
    runAction,
    pendingActionKey,
    actionPending,
    showErrorToast,
    showSuccessToast,
  }
}
