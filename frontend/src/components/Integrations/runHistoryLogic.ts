import type { IntegrationRun } from "./runHistoryApi"

export type RunStatus =
  | "success"
  | "failure"
  | "timed_out"
  | "running"
  | "unknown"

export function runStatus(run: IntegrationRun, now: number): RunStatus {
  if (
    run.result === "success" ||
    run.result === "failure" ||
    run.result === "timed_out"
  ) {
    return run.result
  }
  if (run.finished_at !== null) return "unknown"
  return now >= Date.parse(run.deadline_at) ? "timed_out" : "running"
}

export function runChanges(run: IntegrationRun): string {
  if (run.result !== "success") return "—"
  if (run.changes_detected === true) return "Changes detected"
  if (run.changes_detected === false) return "No changes"
  return "Changes unknown"
}

export function runDuration(run: IntegrationRun, status: RunStatus): string {
  const end =
    run.finished_at ?? (status === "timed_out" ? run.deadline_at : null)
  if (!end) return "—"
  const seconds = Math.max(
    0,
    (Date.parse(end) - Date.parse(run.started_at)) / 1000,
  )
  if (!Number.isFinite(seconds)) return "—"
  return seconds < 60
    ? `${seconds.toFixed(1)} s`
    : `${(seconds / 60).toFixed(1)} min`
}
