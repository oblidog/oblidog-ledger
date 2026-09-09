import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Building2 } from "lucide-react"

import { CategoriesService } from "@/client"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import useCustomToast from "@/hooks/useCustomToast"
import { handleError } from "@/utils"

import {
  assignCategoryCounterparty,
  type CategoryWithCounterparty,
  type CounterpartySummary,
} from "./api"
import { CounterpartyPicker } from "./CounterpartyPicker"

export function CategoryCounterpartyPanel({ ledgerId }: { ledgerId: string }) {
  const queryClient = useQueryClient()
  const { showErrorToast, showSuccessToast } = useCustomToast()
  const categories = useQuery({
    queryFn: () => CategoriesService.readCategories({ ledgerId }),
    queryKey: ["categories", ledgerId, false],
  })

  const assignment = useMutation({
    mutationFn: ({
      categoryId,
      counterparty,
    }: {
      categoryId: string
      counterparty: CounterpartySummary | null
    }) => assignCategoryCounterparty(ledgerId, categoryId, counterparty?.id ?? null),
    onError: handleError.bind(showErrorToast),
    onSuccess: () => {
      showSuccessToast("Category counterparty updated")
      void queryClient.invalidateQueries({ queryKey: ["categories", ledgerId] })
    },
  })

  const rows = (categories.data?.data ?? []) as unknown as CategoryWithCounterparty[]

  if (!rows.length && !categories.isLoading) return null

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Building2 className="size-5 text-primary" />
          <CardTitle>Counterparties</CardTitle>
        </div>
        <CardDescription>
          Choose the default counterparty copied to newly created obligations. Changing it does not rewrite existing obligations.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {categories.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading categories…</p>
        ) : categories.isError ? (
          <p className="text-sm text-destructive">Unable to load category counterparties.</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {rows.map((category) => (
              <div key={category.id} className="rounded-lg border p-3">
                <div className="mb-3 flex items-baseline justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{category.name}</p>
                    <p className="text-xs text-muted-foreground">{category.code}</p>
                  </div>
                </div>
                <CounterpartyPicker
                  value={category.counterparty ?? null}
                  disabled={assignment.isPending}
                  onChange={async (counterparty) => {
                    await assignment.mutateAsync({
                      categoryId: category.id,
                      counterparty,
                    })
                  }}
                />
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
