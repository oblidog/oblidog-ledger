import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { isAxiosError } from "axios"
import { type ReactNode, useId, useState } from "react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { LoadingButton } from "@/components/ui/loading-button"
import useCustomToast from "@/hooks/useCustomToast"
import { handleError } from "@/utils"
import {
  applyCategoryCounterparty,
  previewCategoryCounterpartyApply,
} from "./api"

export function ApplyCategoryCounterpartyDialog({
  ledgerId,
  categoryId,
  categoryName,
  disabled,
  trigger,
}: {
  ledgerId: string
  categoryId: string
  categoryName: string
  disabled: boolean
  trigger: ReactNode
}) {
  const checkboxId = useId()
  const [open, setOpen] = useState(false)
  const [overwrite, setOverwrite] = useState(false)
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const preview = useQuery({
    queryKey: ["category-counterparty-apply", ledgerId, categoryId, overwrite],
    queryFn: () =>
      previewCategoryCounterpartyApply(ledgerId, categoryId, overwrite),
    enabled: open && !disabled,
    staleTime: 0,
  })
  const mutation = useMutation({
    mutationFn: () => {
      if (!preview.data) throw new Error("Preview is unavailable")
      return applyCategoryCounterparty(
        ledgerId,
        categoryId,
        preview.data,
        overwrite,
      )
    },
    onSuccess: (result) => {
      showSuccessToast(result.message)
      setOpen(false)
      for (const key of ["obligations", "obligation", "obligation-actions"]) {
        void queryClient.invalidateQueries({ queryKey: [key, ledgerId] })
      }
    },
    onError: (error) => {
      if (isAxiosError(error)) handleError.bind(showErrorToast)(error)
      else showErrorToast(error.message)
      void preview.refetch()
    },
  })
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (mutation.isPending) return
        setOpen(value)
        if (value) setOverwrite(false)
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Apply counterparty to obligations</DialogTitle>
          <DialogDescription>
            {categoryName}: update existing obligations in the current and next
            period.
          </DialogDescription>
        </DialogHeader>
        <label htmlFor={checkboxId} className="flex items-center gap-2 text-sm">
          <Checkbox
            id={checkboxId}
            checked={overwrite}
            disabled={mutation.isPending}
            onCheckedChange={(value) => setOverwrite(value === true)}
          />
          Replace existing counterparty assignments
        </label>
        <p className="text-sm text-muted-foreground">
          By default, only obligations without a counterparty are updated.
          Previous periods remain unchanged.
        </p>
        {preview.isError ? (
          <div role="alert" className="space-y-2">
            <p>
              Could not load the preview. Check the category counterparty and
              try again.
            </p>
            <Button variant="outline" onClick={() => void preview.refetch()}>
              Retry
            </Button>
          </div>
        ) : preview.isFetching || !preview.data ? (
          <p role="status">Loading preview…</p>
        ) : (
          <div className="rounded-md border p-3 text-sm space-y-2">
            <p>
              Counterparty: <strong>{preview.data.counterparty.name}</strong>
            </p>
            <p>Periods: {preview.data.periods.join(" · ")}</p>
            <p>{preview.data.count} obligations will be updated.</p>
          </div>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            disabled={mutation.isPending}
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
          <LoadingButton
            loading={mutation.isPending}
            disabled={
              disabled ||
              preview.isFetching ||
              preview.isError ||
              !preview.data?.count
            }
            onClick={() => mutation.mutate()}
          >
            Apply counterparty
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
