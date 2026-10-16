import { Link } from "@tanstack/react-router"
import { Database } from "lucide-react"
import { useTranslation } from "react-i18next"
import type { CategoryPublic } from "@/client"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { i18n } from "@/i18n"

export function CategoryCustomDataDialog({
  ledgerId,
  category,
}: {
  ledgerId: string
  category: CategoryPublic
}) {
  useTranslation()

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label={i18n.t("app:categories.view_custom_data_for", {
            value1: category.name,
          })}
          asChild
        >
          <Link
            to={"/ledgers/$ledgerId/categories/$categoryId/data" as never}
            params={{ ledgerId, categoryId: category.id } as never}
          >
            <Database />
            <span className="sr-only">
              {i18n.t("app:categories.view_custom_data_for_72ace4")}{" "}
              {category.name}
            </span>
          </Link>
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {i18n.t("app:categories.view_data_records")}
      </TooltipContent>
    </Tooltip>
  )
}
