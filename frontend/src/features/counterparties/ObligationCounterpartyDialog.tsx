import { useMutation, useQueryClient } from "@tanstack/react-query"
import type { ReactNode } from "react"
import { useEffect, useState } from "react"
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
  DialogTrigger,
} from "@/components/ui/dialog"
import useCustomToast from "@/hooks/useCustomToast"
import { i18n } from "@/i18n"
import { handleError } from "@/utils"

import {
  assignObligationCounterparty,
  type CounterpartySummary,
  type ObligationWithCounterparty,
} from "./api"
import { CounterpartyPicker } from "./CounterpartyPicker"

export function ObligationCounterpartyDialog({
  ledgerId,
  obligation,
  trigger,
}: {
  ledgerId: string
  obligation: ObligationPublic
  trigger: ReactNode
}) {
  useTranslation()

  const counterpartyObligation = obligation as ObligationPublic &
    ObligationWithCounterparty
  const current = counterpartyObligation.counterparty ?? null
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<CounterpartySummary | null>(current)
  const queryClient = useQueryClient()
  const { showErrorToast, showSuccessToast } = useCustomToast()

  useEffect(() => {
    if (open) setDraft(current)
  }, [current, open])

  const mutation = useMutation({
    mutationFn: () =>
      assignObligationCounterparty(ledgerId, obligation.key, draft?.id ?? null),
    onError: handleError.bind(showErrorToast),
    onSuccess: () => {
      showSuccessToast(
        i18n.t("app:counterparties.obligation_counterparty_updated"),
      )
      setOpen(false)
      void queryClient.invalidateQueries({
        queryKey: ["obligation", ledgerId, obligation.key],
      })
      void queryClient.invalidateQueries({
        queryKey: ["obligations", ledgerId],
      })
    },
  })

  const changed = (current?.id ?? null) !== (draft?.id ?? null)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {i18n.t("app:counterparties.counterparty_97b2be")}
          </DialogTitle>
          <DialogDescription>
            {i18n.t("app:counterparties.override_the_counterparty_for")}{" "}
            {obligation.name}
            {i18n.t(
              "app:counterparties.this_changes_only_this_obligation_not_the_category_default_or_other_periods",
            )}
          </DialogDescription>
        </DialogHeader>
        <CounterpartyPicker
          value={draft}
          disabled={mutation.isPending}
          onChange={setDraft}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            {i18n.t("app:counterparties.cancel")}
          </Button>
          <Button
            disabled={!changed || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {i18n.t("app:counterparties.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
