import { useTranslation } from "react-i18next"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { i18n } from "@/i18n"

export function ObligationValueFields({
  idPrefix,
  currency,
  dataReady = false,
  currentAmount,
  setCurrentAmount,
  issueDate,
  setIssueDate,
  dueDate,
  setDueDate,
  dueDateLimits,
  notes,
  setNotes,
}: {
  idPrefix: string
  currency?: string | null
  dataReady?: boolean
  currentAmount: string
  setCurrentAmount: (value: string) => void
  issueDate: string
  setIssueDate: (value: string) => void
  dueDate: string
  setDueDate: (value: string) => void
  dueDateLimits: { min: string; max: string }
  notes: string
  setNotes: (value: string) => void
}) {
  useTranslation()
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-current-amount`}>
            {i18n.t("app:obligations.current_amount")}
            {dataReady ? " *" : ""}
          </Label>
          <div className="relative">
            <Input
              id={`${idPrefix}-current-amount`}
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              className="pr-14 text-right tabular-nums"
              value={currentAmount}
              onChange={(event) => setCurrentAmount(event.target.value)}
            />
            <span className="text-muted-foreground pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm font-medium">
              {currency ?? "—"}
            </span>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-issue-date`}>
            {i18n.t("app:obligations.issue_date")}
          </Label>
          <Input
            id={`${idPrefix}-issue-date`}
            type="date"
            max={dueDate || undefined}
            value={issueDate}
            onChange={(event) => setIssueDate(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-due-date`}>
            {i18n.t("app:obligations.due_date")}
            {dataReady ? " *" : ""}
          </Label>
          <Input
            id={`${idPrefix}-due-date`}
            type="date"
            min={
              issueDate && issueDate > dueDateLimits.min
                ? issueDate
                : dueDateLimits.min
            }
            max={dueDateLimits.max}
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
          />
          <p className="text-muted-foreground text-xs">
            {i18n.t("app:obligations.between")} {dueDateLimits.min}{" "}
            {i18n.t("app:obligations.and")} {dueDateLimits.max}
          </p>
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-notes`}>
          {i18n.t("app:obligations.notes")}
        </Label>
        <textarea
          id={`${idPrefix}-notes`}
          className="border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:bg-input/30 flex min-h-24 w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-[3px]"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
      </div>
    </>
  )
}
