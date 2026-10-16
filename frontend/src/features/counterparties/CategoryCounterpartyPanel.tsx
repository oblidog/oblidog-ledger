import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Building2 } from "lucide-react"
import { useTranslation } from "react-i18next"
import { CategoriesService } from "@/client"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import useCustomToast from "@/hooks/useCustomToast"
import { i18n } from "@/i18n"
import { handleError } from "@/utils"

import {
  assignCategoryCounterparty,
  type CategoryWithCounterparty,
  type CounterpartySummary,
} from "./api"
import { CounterpartyPicker } from "./CounterpartyPicker"

export function CategoryCounterpartyPanel({ ledgerId }: { ledgerId: string }) {
  useTranslation()

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
    }) =>
      assignCategoryCounterparty(
        ledgerId,
        categoryId,
        counterparty?.id ?? null,
      ),
    onError: handleError.bind(showErrorToast),
    onSuccess: () => {
      showSuccessToast(
        i18n.t("app:counterparties.category_counterparty_updated"),
      )
      void queryClient.invalidateQueries({ queryKey: ["categories", ledgerId] })
    },
  })

  const rows = (categories.data?.data ??
    []) as unknown as CategoryWithCounterparty[]

  if (!rows.length && !categories.isLoading) return null

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Building2 className="size-5 text-primary" />
          <CardTitle>{i18n.t("app:counterparties.counterparties")}</CardTitle>
        </div>
        <CardDescription>
          {i18n.t(
            "app:counterparties.choose_the_default_counterparty_copied_to_newly_created_obligations_changing_it_does_",
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {categories.isLoading ? (
          <p className="text-sm text-muted-foreground">
            {i18n.t("app:counterparties.loading_categories")}
          </p>
        ) : categories.isError ? (
          <p className="text-sm text-destructive">
            {i18n.t(
              "app:counterparties.unable_to_load_category_counterparties",
            )}
          </p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {rows.map((category) => (
              <div
                key={category.id}
                data-testid={`category-counterparty-${category.id}`}
                className="rounded-lg border p-3"
              >
                <p className="mb-3 text-xs text-muted-foreground">
                  {i18n.t("app:counterparties.default_for_category_code")}{" "}
                  {category.code}
                </p>
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
