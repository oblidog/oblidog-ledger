import { useQuery } from "@tanstack/react-query"
import { RefreshCw } from "lucide-react"
import { useId, useState } from "react"

import { ApiError } from "@/client"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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
  success: "Success",
  failure: "Failure",
  timed_out: "Timed out",
  running: "Running",
  unknown: "Unknown result",
}

function RunEntry({ run, now }: { run: IntegrationRun; now: number }) {
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
        <span>Duration: {runDuration(run, status)}</span>
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
          Run details
        </summary>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Finished at</dt>
            <dd>{dateTime(run.finished_at)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Deadline</dt>
            <dd>{dateTime(run.deadline_at)}</dd>
          </div>
          <div className="min-w-0 sm:col-span-2">
            <dt className="text-muted-foreground">Run ID</dt>
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
        <CardTitle id={headingId}>Run history</CardTitle>
        <Button
          variant="outline"
          size="sm"
          disabled={history.isFetching}
          onClick={() => void history.refetch()}
        >
          <RefreshCw /> Refresh history
        </Button>
      </CardHeader>
      <CardContent className="min-w-0 space-y-4">
        <p className="text-sm text-muted-foreground">
          Newest first. Completed run history is kept for 90 days.
        </p>
        {history.isError && (
          <Alert variant="destructive">
            <AlertTitle>Could not load run history</AlertTitle>
            <AlertDescription className="space-y-2">
              <p>
                {history.data
                  ? "Displayed history may be out of date."
                  : "Check your connection and access to this ledger."}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void history.refetch()}
                disabled={history.isFetching}
              >
                Retry history
              </Button>
            </AlertDescription>
          </Alert>
        )}
        {history.isPending && <p role="status">Loading run history…</p>}
        {runs?.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {offset === 0
              ? "No runs recorded yet."
              : "No runs on this page. Use Newer runs to return to recent history."}
          </p>
        )}
        {runs && runs.length > 0 && (
          <ol aria-label="Integration runs" className="min-w-0 space-y-3">
            {runs.map((run) => (
              <RunEntry key={run.id} run={run} now={now} />
            ))}
          </ol>
        )}
        {(count > PAGE_SIZE || offset > 0) && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p role="status" className="text-sm text-muted-foreground">
              {runs && runs.length > 0
                ? `${offset + 1}–${offset + runs.length} of ${count} runs`
                : "Run history"}
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
                Newer runs
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
                Older runs
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
