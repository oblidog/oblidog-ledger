import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import {
  type ObligationPublic,
  ObligationsService,
  type PaymentExecution,
} from "@/client"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { i18n } from "@/i18n"
import { handleError } from "@/utils"
import { invalidateObligationAction } from "./obligationQueries"

export function ObligationPaymentExecution({
  ledgerId,
  obligation,
  canEdit,
  onError,
  onSuccess,
}: {
  ledgerId: string
  obligation: ObligationPublic
  canEdit: boolean
  onError: (message: string) => void
  onSuccess: (message: string) => void
}) {
  useTranslation()
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: (value: PaymentExecution | null) =>
      ObligationsService.updateObligation({
        ledgerId,
        obligationKey: obligation.key,
        requestBody: { payment_execution: value },
      }),
    onError: handleError.bind(onError),
    onSuccess: async () => {
      await Promise.all([
        invalidateObligationAction(queryClient, ledgerId, obligation.key),
        queryClient.invalidateQueries({
          queryKey: ["analytics", "attention", ledgerId],
        }),
      ])
      onSuccess(i18n.t("app:obligations.obligation_updated"))
    },
  })
  const readOnly =
    !canEdit ||
    obligation.lifecycle === "paid" ||
    obligation.lifecycle === "canceled"
  return (
    <PaymentExecutionField
      value={obligation.payment_execution ?? null}
      readOnly={readOnly}
      disabled={mutation.isPending}
      onChange={(value) => mutation.mutate(value)}
    />
  )
}

export function PaymentExecutionField({
  value,
  onChange,
  readOnly = false,
  disabled = false,
}: {
  value: PaymentExecution | null
  onChange: (value: PaymentExecution | null) => void
  readOnly?: boolean
  disabled?: boolean
}) {
  useTranslation()
  const selected = value ?? "manual"
  return (
    <div className="space-y-2">
      <Label htmlFor="obligation-payment-execution">
        {i18n.t("app:obligations.payment_execution")}
      </Label>
      {readOnly ? (
        <p>{i18n.t(`app:obligations.payment_execution_${selected}`)}</p>
      ) : (
        <Select
          value={selected}
          disabled={disabled}
          onValueChange={(next) => {
            if (next === selected) return
            if (next === "manual") onChange(null)
            else if (
              next === "scheduled_transfer" ||
              next === "automatic_collection"
            )
              onChange(next)
          }}
        >
          <SelectTrigger
            id="obligation-payment-execution"
            className="min-h-11 w-full"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(
              ["manual", "scheduled_transfer", "automatic_collection"] as const
            ).map((option) => (
              <SelectItem key={option} value={option}>
                {i18n.t(`app:obligations.payment_execution_${option}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <p className="text-xs text-muted-foreground">
        {i18n.t("app:obligations.payment_execution_help")}
      </p>
    </div>
  )
}
