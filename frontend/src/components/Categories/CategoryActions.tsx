import { Link } from "@tanstack/react-router"
import { Ellipsis } from "lucide-react"
import { useTranslation } from "react-i18next"
import type { CategoryPublic } from "@/client"
import { CategoryCustomDataDialog } from "@/components/Categories/CategoryCustomDataDialog"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ApplyCategoryCounterpartyDialog } from "@/features/counterparties/ApplyCategoryCounterpartyDialog"
import { i18n } from "@/i18n"

import { CategoryHistoryDialog } from "./CategoryHistoryDialog"
import { categoryCounterparty } from "./categoryPresentation"
import { EditCategoryDialog } from "./EditCategoryDialog"

export function CategoryActions({
  ledgerId,
  category,
  groups,
  onArchive,
  onRestore,
}: {
  ledgerId: string
  category: CategoryPublic
  groups: { id: string; name: string; is_active: boolean }[]
  onArchive: (categoryId: string) => void
  onRestore: (categoryId: string) => void
}) {
  useTranslation()

  return (
    <div className="flex justify-end gap-1">
      {category.has_data_schema && (
        <CategoryCustomDataDialog ledgerId={ledgerId} category={category} />
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            aria-label={i18n.t("app:categories.more_actions_for", {
              value1: category.name,
            })}
          >
            <Ellipsis />
            <span className="sr-only">
              {i18n.t("app:categories.more_actions_for_5ac859")} {category.name}
            </span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <CategoryHistoryDialog
            ledgerId={ledgerId}
            category={category}
            trigger={
              <DropdownMenuItem onSelect={(event) => event.preventDefault()}>
                {i18n.t("app:categories.view_amount_history")}
              </DropdownMenuItem>
            }
          />
          <DropdownMenuItem asChild>
            <Link
              to="/ledgers/$ledgerId/categories/$categoryId/custom-fields"
              params={{ ledgerId, categoryId: category.id }}
            >
              {i18n.t("app:categories.manage_custom_fields")}
            </Link>
          </DropdownMenuItem>
          <EditCategoryDialog
            ledgerId={ledgerId}
            category={category}
            groups={groups}
            trigger={
              <DropdownMenuItem onSelect={(event) => event.preventDefault()}>
                {i18n.t("app:categories.edit_category")}
              </DropdownMenuItem>
            }
          />
          <ApplyCategoryCounterpartyDialog
            ledgerId={ledgerId}
            categoryId={category.id}
            categoryName={category.name}
            disabled={!categoryCounterparty(category)}
            trigger={
              <DropdownMenuItem
                disabled={!categoryCounterparty(category)}
                onSelect={(event) => event.preventDefault()}
              >
                {i18n.t("app:categories.apply_counterparty_to_obligations")}
              </DropdownMenuItem>
            }
          />
          <DropdownMenuSeparator />
          {category.is_active ? (
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => onArchive(category.id)}
            >
              {i18n.t("app:categories.archive_category")}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={() => onRestore(category.id)}>
              {i18n.t("app:categories.restore_category")}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
