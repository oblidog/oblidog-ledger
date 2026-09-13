import { Minus, Pencil, Plus } from "lucide-react"
import type { ReactNode } from "react"

import type { CategoryDataRecordPublic } from "@/client"
import {
  type CategoryDataPropertySchema,
  formatCategoryDataValue,
} from "@/components/Categories/CategoryDataValue"
import { Badge } from "@/components/ui/badge"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

export type CategoryDataDifference =
  | { kind: "added"; currentValue: unknown }
  | { kind: "removed"; previousValue: unknown }
  | { kind: "changed"; currentValue: unknown; previousValue: unknown }

function hasOwnValue(data: Record<string, unknown>, propertyName: string) {
  return Object.getOwnPropertyDescriptor(data, propertyName) !== undefined
}

function jsonValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true

  if (left === null || right === null) return false
  if (typeof left !== "object" || typeof right !== "object") return false

  // Nested values do not get semantic field-by-field differences. Equality is
  // still structural so an unchanged JSON payload is not marked as changed.
  return JSON.stringify(left) === JSON.stringify(right)
}

export function compareCategoryDataValues(
  currentData: Record<string, unknown>,
  previousData: Record<string, unknown>,
  propertyName: string,
): CategoryDataDifference | null {
  const hasCurrent = hasOwnValue(currentData, propertyName)
  const hasPrevious = hasOwnValue(previousData, propertyName)

  if (!hasCurrent && !hasPrevious) return null
  if (hasCurrent && !hasPrevious) {
    return { kind: "added", currentValue: currentData[propertyName] }
  }
  if (!hasCurrent && hasPrevious) {
    return { kind: "removed", previousValue: previousData[propertyName] }
  }

  const currentValue = currentData[propertyName]
  const previousValue = previousData[propertyName]
  if (jsonValuesEqual(currentValue, previousValue)) return null

  return { kind: "changed", currentValue, previousValue }
}

/**
 * The records endpoint is ordered newest first. Its final item may be an extra
 * pagination-context record, so mapping before trimming the visible rows keeps
 * the oldest visible row comparable without rendering that extra item.
 */
export function buildPreviousRecordMap(
  recordsNewestFirst: CategoryDataRecordPublic[],
) {
  const previousByRecordId = new Map<string, CategoryDataRecordPublic>()

  for (let index = 0; index < recordsNewestFirst.length - 1; index += 1) {
    const current = recordsNewestFirst[index]
    const previous = recordsNewestFirst[index + 1]
    if (current.schema_version === previous.schema_version) {
      previousByRecordId.set(current.id, previous)
    }
  }

  return previousByRecordId
}

function plainValueLabel(value: unknown, present: boolean) {
  if (!present) return "not set"
  if (value === null) return "null"
  if (typeof value === "object") return JSON.stringify(value)
  return String(value)
}

function DifferenceBadge({
  difference,
}: {
  difference: CategoryDataDifference
}) {
  if (difference.kind === "added") {
    return (
      <Badge
        variant="outline"
        className="border-emerald-500/50 bg-emerald-500/10"
      >
        <Plus aria-hidden="true" /> Added
      </Badge>
    )
  }

  if (difference.kind === "removed") {
    return (
      <Badge variant="outline" className="border-rose-500/50 bg-rose-500/10">
        <Minus aria-hidden="true" /> Removed
      </Badge>
    )
  }

  if (
    typeof difference.currentValue === "number" &&
    typeof difference.previousValue === "number"
  ) {
    const delta = difference.currentValue - difference.previousValue
    return (
      <Badge variant="outline" className="border-amber-500/50 bg-amber-500/10">
        <Pencil aria-hidden="true" />
        {new Intl.NumberFormat(undefined, {
          maximumFractionDigits: 20,
          signDisplay: "always",
        }).format(delta)}
      </Badge>
    )
  }

  return (
    <Badge variant="outline" className="border-amber-500/50 bg-amber-500/10">
      <Pencil aria-hidden="true" /> Changed
    </Badge>
  )
}

function DifferenceDetail({
  difference,
  schema,
}: {
  difference: CategoryDataDifference
  schema: CategoryDataPropertySchema
}) {
  if (difference.kind === "added") {
    return (
      <>
        <p className="font-medium">Added value</p>
        <p>Previous: not set</p>
      </>
    )
  }

  const previousValue = difference.previousValue
  return (
    <>
      <p className="font-medium">
        {difference.kind === "removed" ? "Removed value" : "Changed value"}
      </p>
      <div className="flex max-w-72 items-start gap-1">
        <span>Previous:</span>
        <span>{formatCategoryDataValue(previousValue, schema)}</span>
      </div>
    </>
  )
}

export function CategoryDataDifferenceValue({
  currentData,
  previousData,
  propertyName,
  schema,
  showDifferences,
}: {
  currentData: Record<string, unknown>
  previousData?: Record<string, unknown>
  propertyName: string
  schema: CategoryDataPropertySchema
  showDifferences: boolean
}) {
  const currentPresent = hasOwnValue(currentData, propertyName)
  const currentValue = currentData[propertyName]
  const formattedValue: ReactNode = formatCategoryDataValue(
    currentValue,
    schema,
  )
  const difference =
    showDifferences && previousData
      ? compareCategoryDataValues(currentData, previousData, propertyName)
      : null

  if (!difference) return formattedValue

  const previousPresent = difference.kind !== "added"
  const previousValue = previousPresent ? difference.previousValue : undefined
  const accessibleLabel = `${difference.kind}. Current: ${plainValueLabel(currentValue, currentPresent)}. Previous: ${plainValueLabel(previousValue, previousPresent)}`

  return (
    <div
      className={cn(
        "flex min-w-max items-center gap-2 rounded px-1 py-0.5",
        difference.kind === "added" && "bg-emerald-500/5",
        difference.kind === "removed" && "bg-rose-500/5",
        difference.kind === "changed" && "bg-amber-500/5",
      )}
    >
      <span>{formattedValue}</span>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="rounded-full text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={accessibleLabel}
          >
            <DifferenceBadge difference={difference} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">
          <DifferenceDetail difference={difference} schema={schema} />
        </TooltipContent>
      </Tooltip>
    </div>
  )
}
