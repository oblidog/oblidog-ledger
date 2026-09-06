import { Link } from "@tanstack/react-router"
import { Database } from "lucide-react"
import type { ReactNode } from "react"

import type { CategoryPublic } from "@/client"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

export function CategoryCustomDataDialog({
  ledgerId,
  category,
  trigger,
}: {
  ledgerId: string
  category: CategoryPublic
  trigger?: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label={`View custom data for ${category.name}`}
          asChild
        >
          <Link
            to="/ledgers/$ledgerId/categories/$categoryId/data"
            params={{ ledgerId, categoryId: category.id }}
          >
            {trigger || (
              <>
                <Database />
                <span className="sr-only">
                  View custom data for {category.name}
                </span>
              </>
            )}
          </Link>
        </Button>
      </TooltipTrigger>
      <TooltipContent>View data records</TooltipContent>
    </Tooltip>
  )
}
