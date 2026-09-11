import { useMutation, useQueryClient } from "@tanstack/react-query"
import type { ReactNode } from "react"
import { useEffect, useState } from "react"

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
      showSuccessToast("Obligation counterparty updated")
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
          <DialogTitle>Counterparty</DialogTitle>
          <DialogDescription>
            Override the counterparty for {obligation.name}. This changes only
            this obligation, not the category default or other periods.
          </DialogDescription>
        </DialogHeader>
        <CounterpartyPicker
          value={draft}
          disabled={mutation.isPending}
          onChange={setDraft}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            disabled={!changed || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
