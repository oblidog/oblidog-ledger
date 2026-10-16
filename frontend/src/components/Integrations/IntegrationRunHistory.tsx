import { useQuery } from "@tanstack/react-query"
import { RefreshCw } from "lucide-react"
import { useId, useState } from "react"
import { useTranslation } from "react-i18next"
import { ApiError } from "@/client"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { i18n } from "@/i18n"
import { type IntegrationRun, listIntegrationRuns } from "./runHistoryApi"
import {
  type RunStatus,
  runChanges,
  runDuration,
  runStatus,
} from "./runHistoryLogic"
import { dateTime } from "./shared"

const PAGE_SIZE = 20
const statusLabels: Record<RunStatus, string> = {
  get success() {
    return i18n.t("app:integrations.success")
  },
  get failure() {
    return i18n.t("app:integrations.failure")
  },
  get timed_out() {
    return i18n.t("app:integrations.timed_out")
  },
  get running() {
    return i18n.t("app:integrations.running")
  },
  get unknown() {
    return i18n.t("app:integrations.unknown_result")
  },
}

function RunEntry({ run, now }: { run: IntegrationRun; now: number }) {
  useTranslation()

  const status = runStatus(run, now)
  return (
    <li className="min-w-0 space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <time dateTime={run.started_at} className="text-sm font-medium">
          {dateTime(run.started_at)}
        </time>
        <Badge
          variant={
            status === "failure" || status === "timed_out"
              ? "destructive"
              : status === "success"
                ? "default"
                : "secondary"
          }
        >
          {statusLabels[status]}
        </Badge>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
        {run.result === "success" && <span>{runChanges(run)}</span>}
        <span>
          {i18n.t("app:integrations.duration")} {runDuration(run, status)}
        </span>
      </div>
      {(run.error_code || run.error_message) && (
        <div className="min-w-0 rounded-md bg-destructive/10 p-3 text-sm">
          {run.error_code && (
            <p className="break-all font-medium">{run.error_code}</p>
          )}
          {run.error_message && (
            <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
              {run.error_message}
            </p>
          )}
        </div>
      )}
      <details>
        <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
          {i18n.t("app:integrations.run_details")}
        </summary>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">
              {i18n.t("app:integrations.finished_at")}
            </dt>
            <dd>{dateTime(run.finished_at)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">
              {i18n.t("app:integrations.deadline")}
            </dt>
            <dd>{dateTime(run.deadline_at)}</dd>
          </div>
          <div className="min-w-0 sm:col-span-2">
            <dt className="text-muted-foreground">
              {i18n.t("app:integrations.run_id")}
            </dt>
            <dd className="break-all font-mono">{run.id}</dd>
          </div>
        </dl>
      </details>
    </li>
  )
}

export function IntegrationRunHistory({
  ledgerId,
  integrationId,
}: {
  ledgerId: string
  integrationId: string
}) {
  useTranslation()

  const headingId = useId()
  const [offset, setOffset] = useState(0)
  const history = useQuery({
    queryKey: ["integration-runs", ledgerId, integrationId, offset],
    queryFn: ({ signal }) =>
      listIntegrationRuns(ledgerId, integrationId, PAGE_SIZE, offset, signal),
    refetchInterval: 15_000,
    retry: (count, error) =>
      !(
        error instanceof ApiError &&
        (error.response?.status === 403 || error.response?.status === 404)
      ) && count < 2,
  })
  const runs = history.data?.data
  const count = history.data?.count ?? 0
  const now = Date.now()

  return (
    <Card className="min-w-0" role="region" aria-labelledby={headingId}>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <CardTitle id={headingId}>
          {i18n.t("app:integrations.run_history")}
        </CardTitle>
        <Button
          variant="outline"
          size="sm"
          disabled={history.isFetching}
          onClick={() => void history.refetch()}
        >
          <RefreshCw /> {i18n.t("app:integrations.refresh_history")}
        </Button>
      </CardHeader>
      <CardContent className="min-w-0 space-y-4">
        <p className="text-sm text-muted-foreground">
          {i18n.t(
            "app:integrations.newest_first_completed_run_history_is_kept_for_90_days",
          )}
        </p>
        {history.isError && (
          <Alert variant="destructive">
            <AlertTitle>
              {i18n.t("app:integrations.could_not_load_run_history")}
            </AlertTitle>
            <AlertDescription className="space-y-2">
              <p>
                {history.data
                  ? i18n.t(
                      "app:integrations.displayed_history_may_be_out_of_date",
                    )
                  : i18n.t(
                      "app:integrations.check_your_connection_and_access_to_this_ledger",
                    )}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void history.refetch()}
                disabled={history.isFetching}
              >
                {i18n.t("app:integrations.retry_history")}
              </Button>
            </AlertDescription>
          </Alert>
        )}
        {history.isPending && (
          <p role="status">{i18n.t("app:integrations.loading_run_history")}</p>
        )}
        {runs?.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {offset === 0
              ? i18n.t("app:integrations.no_runs_recorded_yet")
              : i18n.t(
                  "app:integrations.no_runs_on_this_page_use_newer_runs_to_return_to_recent_history",
                )}
          </p>
        )}
        {runs && runs.length > 0 && (
          <ol
            aria-label={i18n.t("app:integrations.integration_runs")}
            className="min-w-0 space-y-3"
          >
            {runs.map((run) => (
              <RunEntry key={run.id} run={run} now={now} />
            ))}
          </ol>
        )}
        {(count > PAGE_SIZE || offset > 0) && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p role="status" className="text-sm text-muted-foreground">
              {runs && runs.length > 0
                ? i18n.t("app:integrations.of_runs", {
                    value1: offset + 1,
                    value2: offset + runs.length,
                    value3: count,
                  })
                : i18n.t("app:integrations.run_history")}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={offset === 0 || history.isFetching}
                onClick={() =>
                  setOffset((value) => Math.max(0, value - PAGE_SIZE))
                }
              >
                {i18n.t("app:integrations.newer_runs")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={
                  !history.data ||
                  offset + PAGE_SIZE >= count ||
                  history.isFetching
                }
                onClick={() => setOffset((value) => value + PAGE_SIZE)}
              >
                {i18n.t("app:integrations.older_runs")}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
