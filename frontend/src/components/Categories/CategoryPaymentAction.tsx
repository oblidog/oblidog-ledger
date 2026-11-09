import { Link } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import type { CategoryPublic } from "@/client"
import { Button } from "@/components/ui/button"
import {
  firstScheduledPaymentSearch,
  firstScheduledPeriod,
} from "./categoryPresentation"
import { EditCategoryDialog } from "./EditCategoryDialog"

type Props = Pick<
  Parameters<typeof EditCategoryDialog>[0],
  "ledgerId" | "groups"
> & {
  category: CategoryPublic
  canEdit: boolean
}

export function CategoryPaymentAction({
  ledgerId,
  groups,
  category,
  canEdit,
}: Props) {
  const { t } = useTranslation(["app"])
  if (!category.is_active) return null

  const period = firstScheduledPeriod(category)
  if (period) {
    return (
      <Button asChild variant="outline" size="sm" className="min-h-11">
        <Link
          to="/ledgers/$ledgerId"
          params={{ ledgerId }}
          search={firstScheduledPaymentSearch(
            category.code,
            period,
            category.data_source_policy === "automatic",
          )}
          aria-label={t("app:categories.first_payment_for", {
            name: category.name,
          })}
        >
          {t("app:categories.first_payment")}
        </Link>
      </Button>
    )
  }
  if (!canEdit) return null

  return (
    <EditCategoryDialog
      ledgerId={ledgerId}
      groups={groups}
      category={category}
      trigger={
        <Button
          variant="outline"
          size="sm"
          className="min-h-11"
          aria-label={t("app:categories.set_up_schedule_for", {
            name: category.name,
          })}
        >
          {t("app:categories.set_up_schedule")}
        </Button>
      }
    />
  )
}
