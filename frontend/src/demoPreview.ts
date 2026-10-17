import type { SystemRunsPublic, SystemRunTaskPublic } from "@/client"

// Presentation-only records. Never send their identifiers to mutation endpoints.
// All restricted backend endpoints retain their existing authorization.
function sampleTimes(daysAgo = 0) {
  const start = new Date()
  start.setUTCDate(start.getUTCDate() - daysAgo)
  start.setUTCHours(7, 30, 0, 0)
  // Always show completed runs in the past, including before 07:30 UTC.
  if (start.getTime() + 18000 > Date.now())
    start.setUTCDate(start.getUTCDate() - 1)
  return {
    started_at: start.toISOString(),
    finished_at: new Date(start.getTime() + 18000).toISOString(),
    deadline_at: new Date(start.getTime() + 300000).toISOString(),
  }
}

export const demoSystemTasks: SystemRunTaskPublic[] = [
  { name: "ensure_obligations", mode: "scheduled" },
  { name: "scheduled_reports", mode: "disabled" },
  { name: "maintenance_cleanup", mode: "scheduled" },
]

export function demoSystemRuns(ledgerId: string): SystemRunsPublic {
  const times = sampleTimes()
  return {
    count: 1,
    data: [
      {
        id: "demo-system-run",
        status: "success",
        trigger: "scheduled",
        effective_at: times.started_at,
        timezone: "Europe/Warsaw",
        business_date: times.started_at.slice(0, 10),
        summary: { succeeded_steps: 1, failed_steps: 0, skipped_steps: 0 },
        error: null,
        started_at: times.started_at,
        finished_at: times.finished_at,
        steps: [
          {
            id: "demo-ensure-obligations",
            task_name: "ensure_obligations",
            ledger_id: ledgerId,
            status: "succeeded",
            skip_reason: null,
            error: null,
            summary: { created_obligations: 3 },
            started_at: times.started_at,
            finished_at: times.finished_at,
          },
        ],
      },
    ],
  }
}
