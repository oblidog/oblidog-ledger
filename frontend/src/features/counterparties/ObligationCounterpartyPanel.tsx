import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Building2 } from "lucide-react"

import { ObligationsService } from "@/client"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import useCustomToast from "@/hooks/useCustomToast"
import { handleError } from "@/utils"

import {
  assignObligationCounterparty,
  type CounterpartySummary,
  type ObligationWithCounterparty,
} from "./api"
import { CounterpartyLogo } from "./CounterpartyLogo"
import { CounterpartyPicker } from "./CounterpartyPicker"

function currentPeriod() {
  const now = new Date()
  return { year: now.getFullYear(), month: now.getMonth() + 1 }
}

export function ObligationCounterpartyPanel({
  ledgerId,
  canEdit,
}: {
  ledgerId: string
  canEdit: boolean
}) {
  const period = currentPeriod()
  const queryClient = useQueryClient()
  const { showErrorToast, showSuccessToast } = useCustomToast()
  const obligations = useQuery({
    queryFn: () =>
      ObligationsService.readObligations({
        ledgerId,
        year: period.year,
        month: period.month,
      }),
    queryKey: ["obligations", ledgerId, "counterparty-panel", period.year, period.month],
  })

  const assignment = useMutation({
    mutationFn: ({
      obligationKey,
      counterparty,
    }: {
      obligationKey: string
      counterparty: CounterpartySummary | null
    }) => assignObligationCounterparty(ledgerId, obligationKey, counterparty?.id ?? null),
    onError: handleError.bind(showErrorToast),
    onSuccess: (_, variables) => {
      showSuccessToast("Obligation counterparty updated")
      void queryClient.invalidateQueries({ queryKey: ["obligations", ledgerId] })
      void queryClient.invalidateQueries({
        queryKey: ["obligation", ledgerId, variables.obligationKey],
      })
    },
  })

  const rows = (obligations.data?.data ?? []) as unknown as ObligationWithCounterparty[]

  if (!rows.length && !obligations.isLoading) return null

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Building2 className="size-5 text-primary" />
          <CardTitle>Counterparties this month</CardTitle>
        </div>
        <CardDescription>
          Counterparties are stored on each obligation. You can override the category default without changing other periods.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {obligations.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading counterparties…</p>
        ) : obligations.isError ? (
          <p className="text-sm text-destructive">Unable to load obligation counterparties.</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {rows.map((obligation) => (
              <div
                key={obligation.key}
                data-testid={`obligation-counterparty-${obligation.key}`}
                className="rounded-lg border p-3"
              >
                <div className="mb-3 flex items-start gap-3">
                  <CounterpartyLogo counterparty={obligation.counterparty ?? null} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs text-muted-foreground">
                      {obligation.key} · {obligation.lifecycle}
                    </p>
                    <p className="mt-1 truncate text-xs">
                      {obligation.counterparty?.short_name ||
                        obligation.counterparty?.name ||
                        "No counterparty assigned"}
                    </p>
                  </div>
                </div>
                {canEdit ? (
                  <CounterpartyPicker
                    value={obligation.counterparty ?? null}
                    disabled={assignment.isPending}
                    onChange={async (counterparty) => {
                      await assignment.mutateAsync({
                        obligationKey: obligation.key,
                        counterparty,
                      })
                    }}
                  />
                ) : null}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
