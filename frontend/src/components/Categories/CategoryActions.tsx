import { Link } from "@tanstack/react-router"
import { Ellipsis } from "lucide-react"
import { useRef, useState } from "react"
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
  const [dialog, setDialog] = useState<"history" | "edit" | "apply" | null>(
    null,
  )
  const menuTrigger = useRef<HTMLButtonElement>(null)
  const hasCounterparty = Boolean(categoryCounterparty(category))

  const closeDialog = () => setDialog(null)
  const restoreMenuFocus = (event: Event) => {
    event.preventDefault()
    menuTrigger.current?.focus()
  }

  return (
    <div className="flex justify-end gap-1">
      {category.has_data_schema && (
        <CategoryCustomDataDialog ledgerId={ledgerId} category={category} />
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            ref={menuTrigger}
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
        <DropdownMenuContent
          align="end"
          onCloseAutoFocus={(event) => {
            if (dialog) event.preventDefault()
          }}
        >
          <DropdownMenuItem onSelect={() => setDialog("history")}>
            {i18n.t("app:categories.view_amount_history")}
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link
              to="/ledgers/$ledgerId/categories/$categoryId/custom-fields"
              params={{ ledgerId, categoryId: category.id }}
            >
              {i18n.t("app:categories.manage_custom_fields")}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setDialog("edit")}>
            {i18n.t("app:categories.edit_category")}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!hasCounterparty}
            onSelect={() => setDialog("apply")}
          >
            {i18n.t("app:categories.apply_counterparty_to_obligations")}
          </DropdownMenuItem>
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
      {dialog === "history" && (
        <CategoryHistoryDialog
          ledgerId={ledgerId}
          category={category}
          onClose={closeDialog}
          onCloseAutoFocus={restoreMenuFocus}
        />
      )}
      {dialog === "edit" && (
        <EditCategoryDialog
          ledgerId={ledgerId}
          category={category}
          groups={groups}
          open
          onOpenChange={closeDialog}
          onCloseAutoFocus={restoreMenuFocus}
        />
      )}
      {dialog === "apply" && (
        <ApplyCategoryCounterpartyDialog
          ledgerId={ledgerId}
          categoryId={category.id}
          categoryName={category.name}
          disabled={!hasCounterparty}
          onClose={closeDialog}
          onCloseAutoFocus={restoreMenuFocus}
        />
      )}
    </div>
  )
}
