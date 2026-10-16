import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { type ReactNode, useId, useState } from "react"
import { useTranslation } from "react-i18next"
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
import { i18n } from "@/i18n"
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
  useTranslation()

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
      if (!preview.data)
        throw new Error(i18n.t("app:counterparties.preview_is_unavailable"))
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
      handleError.bind(showErrorToast)(error)
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
          <DialogTitle>
            {i18n.t("app:counterparties.apply_counterparty_to_obligations")}
          </DialogTitle>
          <DialogDescription>
            {categoryName}
            {i18n.t(
              "app:counterparties.update_existing_obligations_in_the_current_and_next_period",
            )}
          </DialogDescription>
        </DialogHeader>
        <label htmlFor={checkboxId} className="flex items-center gap-2 text-sm">
          <Checkbox
            id={checkboxId}
            checked={overwrite}
            disabled={mutation.isPending}
            onCheckedChange={(value) => setOverwrite(value === true)}
          />
          {i18n.t(
            "app:counterparties.replace_existing_counterparty_assignments",
          )}
        </label>
        <p className="text-sm text-muted-foreground">
          {i18n.t(
            "app:counterparties.by_default_only_obligations_without_a_counterparty_are_updated_previous_periods_remai",
          )}
        </p>
        {preview.isError ? (
          <div role="alert" className="space-y-2">
            <p>
              {i18n.t(
                "app:counterparties.could_not_load_the_preview_check_the_category_counterparty_and_try_again",
              )}
            </p>
            <Button variant="outline" onClick={() => void preview.refetch()}>
              {i18n.t("app:counterparties.retry")}
            </Button>
          </div>
        ) : preview.isFetching || !preview.data ? (
          <p role="status">{i18n.t("app:counterparties.loading_preview")}</p>
        ) : (
          <div className="rounded-md border p-3 text-sm space-y-2">
            <p>
              {i18n.t("app:counterparties.counterparty")}{" "}
              <strong>{preview.data.counterparty.name}</strong>
            </p>
            <p>
              {i18n.t("app:counterparties.periods")}{" "}
              {preview.data.periods.join(" · ")}
            </p>
            <p>
              {preview.data.count}{" "}
              {i18n.t("app:counterparties.obligations_will_be_updated")}
            </p>
          </div>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            disabled={mutation.isPending}
            onClick={() => setOpen(false)}
          >
            {i18n.t("app:counterparties.cancel")}
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
            {i18n.t("app:counterparties.apply_counterparty")}
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
