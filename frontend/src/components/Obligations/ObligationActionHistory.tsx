import { useInfiniteQuery } from "@tanstack/react-query"
import { ChevronDown, Clock3 } from "lucide-react"

import {
  type ObligationActionPublic,
  type ObligationActionType,
  ObligationsService,
} from "@/client"
import { Button } from "@/components/ui/button"

const PAGE_SIZE = 20

const actionLabels: Record<ObligationActionType, string> = {
  created: "Created obligation",
  values_updated: "Updated obligation",
  components_changed: "Changed components",
  marked_ready: "Marked as ready",
  marked_paid: "Marked as paid",
  canceled: "Canceled obligation",
  reopened: "Reopened obligation",
  marked_error: "Marked as error",
}

const fieldLabels: Record<string, string> = {
  lifecycle: "Lifecycle",
  current_amount: "Amount",
  currency: "Currency",
  issue_date: "Issue date",
  due_date: "Due date",
  paid_at: "Paid at",
  notes: "Notes",
  amount_state: "Amount status",
  amount_source: "Amount source",
  issue_date_state: "Issue date status",
  issue_date_source: "Issue date source",
  due_date_state: "Due date status",
  due_date_source: "Due date source",
}

type Change = { from?: unknown; to?: unknown }
type ComponentSnapshot = {
  id?: string
  label?: string
  type?: string
  amount?: unknown
  changes?: Record<string, Change>
}
type ComponentChanges = {
  added?: ComponentSnapshot[]
  updated?: ComponentSnapshot[]
  removed?: ComponentSnapshot[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function humanize(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/^./, (letter: string) => letter.toUpperCase())
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—"
  if (typeof value === "boolean") return value ? "Yes" : "No"
  if (typeof value === "string") {
    const date = new Date(value)
    if (/^\d{4}-\d{2}-\d{2}T/.test(value) && !Number.isNaN(date.valueOf())) {
      return formatDateTime(value)
    }
    return value.replace(/_/g, " ")
  }
  if (typeof value === "number") return String(value)
  return JSON.stringify(value)
}

function isChange(value: unknown): value is Change {
  return isRecord(value) && ("from" in value || "to" in value)
}

function componentName(component: ComponentSnapshot) {
  return component.label || component.type || "Component"
}

function FieldDiff({ name, change }: { name: string; change: Change }) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[9rem_1fr] sm:gap-3">
      <dt className="text-muted-foreground">
        {fieldLabels[name] ?? humanize(name)}
      </dt>
      <dd className="min-w-0 break-words">
        <span className="line-through decoration-muted-foreground/60">
          {formatValue(change.from)}
        </span>
        <span aria-hidden="true" className="text-muted-foreground px-2">
          →
        </span>
        <span>{formatValue(change.to)}</span>
      </dd>
    </div>
  )
}

function ComponentDiffs({ changes }: { changes: ComponentChanges }) {
  const rows = [
    ...(changes.added ?? []).map((component) => ({
      kind: "added" as const,
      component,
    })),
    ...(changes.updated ?? []).map((component) => ({
      kind: "updated" as const,
      component,
    })),
    ...(changes.removed ?? []).map((component) => ({
      kind: "removed" as const,
      component,
    })),
  ]

  if (rows.length === 0) return null

  return (
    <div className="space-y-2">
      {rows.map(({ kind, component }, index) => (
        <div
          key={`${kind}-${component.id ?? component.label ?? index}`}
          className="rounded-md border bg-background/60 px-3 py-2"
        >
          <p className="font-medium">
            <span
              className={
                kind === "added"
                  ? "text-emerald-700 dark:text-emerald-300"
                  : kind === "removed"
                    ? "text-red-700 dark:text-red-300"
                    : "text-amber-700 dark:text-amber-300"
              }
            >
              {kind === "added" ? "+" : kind === "removed" ? "−" : "~"}
            </span>{" "}
            {componentName(component)}
          </p>
          {kind !== "updated" && component.amount !== undefined ? (
            <p className="text-muted-foreground mt-1 text-xs">
              Amount: {formatValue(component.amount)}
            </p>
          ) : null}
          {kind === "updated" && component.changes ? (
            <dl className="mt-2 space-y-1 text-xs">
              {Object.entries(component.changes).map(([name, change]) => (
                <FieldDiff key={name} name={name} change={change} />
              ))}
            </dl>
          ) : null}
        </div>
      ))}
    </div>
  )
}

function ActionDetails({ action }: { action: ObligationActionPublic }) {
  const componentValue = action.changes.components
  const components = isRecord(componentValue)
    ? (componentValue as ComponentChanges)
    : null
  const fields = Object.entries(action.changes).filter(
    ([name, value]) => name !== "components" && isChange(value),
  ) as [string, Change][]
  const hasKnownDetails = fields.length > 0 || components !== null

  if (!hasKnownDetails) {
    if (Object.keys(action.changes).length === 0) return null
    return (
      <details className="mt-2 text-xs">
        <summary className="text-muted-foreground cursor-pointer">
          Technical details
        </summary>
        <pre className="mt-2 overflow-x-auto rounded-md bg-muted p-2">
          {JSON.stringify(action.changes, null, 2)}
        </pre>
      </details>
    )
  }

  const content = (
    <div className="space-y-3">
      {fields.length > 0 ? (
        <dl className="space-y-1.5">
          {fields.map(([name, change]) => (
            <FieldDiff key={name} name={name} change={change} />
          ))}
        </dl>
      ) : null}
      {components ? <ComponentDiffs changes={components} /> : null}
    </div>
  )

  if (
    fields.length +
      (components ? Object.values(components).flat().length : 0) <=
    2
  ) {
    return <div className="mt-3 text-xs sm:text-sm">{content}</div>
  }

  return (
    <details className="mt-3 text-xs sm:text-sm">
      <summary className="text-muted-foreground flex cursor-pointer items-center gap-1 font-medium">
        <ChevronDown className="size-3.5" /> Show changes
      </summary>
      <div className="mt-2">{content}</div>
    </details>
  )
}

function ActionEntry({ action }: { action: ObligationActionPublic }) {
  return (
    <li className="relative pl-7">
      <span className="bg-background absolute left-0 top-1 flex size-4 items-center justify-center rounded-full border">
        <span className="bg-primary size-1.5 rounded-full" />
      </span>
      <div className="pb-5">
        <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
          <p className="font-medium">
            {actionLabels[action.action] ?? humanize(action.action)}
          </p>
          <time
            className="text-muted-foreground shrink-0 text-xs"
            dateTime={action.created_at}
          >
            {formatDateTime(action.created_at)}
          </time>
        </div>
        <p className="text-muted-foreground mt-0.5 text-xs">
          {action.actor_display_name || humanize(action.actor_type)}
        </p>
        <ActionDetails action={action} />
      </div>
    </li>
  )
}

export function ObligationActionHistory({
  ledgerId,
  obligationKey,
}: {
  ledgerId: string
  obligationKey: string
}) {
  const history = useInfiniteQuery({
    queryKey: ["obligation-actions", ledgerId, obligationKey],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      ObligationsService.readObligationActions({
        ledgerId,
        obligationKey,
        limit: PAGE_SIZE,
        offset: pageParam,
      }),
    getNextPageParam: (lastPage, pages) => {
      const loaded = pages.reduce((total, page) => total + page.data.length, 0)
      return loaded < lastPage.count ? loaded : undefined
    },
  })
  const actions = history.data?.pages.flatMap((page) => page.data) ?? []

  return (
    <section
      aria-labelledby="obligation-action-history"
      className="border-t pt-4"
    >
      <div className="mb-3 flex items-center gap-2">
        <Clock3 className="text-muted-foreground size-4" />
        <h2 id="obligation-action-history" className="font-medium">
          Action history
        </h2>
      </div>
      {history.isPending ? (
        <p className="text-muted-foreground text-sm">Loading action history…</p>
      ) : null}
      {history.isError ? (
        <div className="flex items-center gap-3 text-sm text-destructive">
          <span>Unable to load action history.</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void history.refetch()}
          >
            Try again
          </Button>
        </div>
      ) : null}
      {!history.isPending && !history.isError && actions.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No activity recorded yet.
        </p>
      ) : null}
      {actions.length > 0 ? (
        <ol className="before:bg-border relative before:absolute before:bottom-5 before:left-[0.45rem] before:top-2 before:w-px">
          {actions.map((action) => (
            <ActionEntry key={action.id} action={action} />
          ))}
        </ol>
      ) : null}
      {history.hasNextPage ? (
        <Button
          variant="outline"
          size="sm"
          disabled={history.isFetchingNextPage}
          onClick={() => void history.fetchNextPage()}
        >
          {history.isFetchingNextPage ? "Loading…" : "Load more"}
        </Button>
      ) : null}
    </section>
  )
}
