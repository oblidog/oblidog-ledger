import { describe, expect, test } from "bun:test"
import type { IntegrationRun } from "./runHistoryApi"
import { runChanges, runDuration, runStatus } from "./runHistoryLogic"

const run = (overrides: Partial<IntegrationRun> = {}): IntegrationRun => ({
  id: "run",
  integration_id: "integration",
  started_at: "2026-10-09T10:00:00Z",
  deadline_at: "2026-10-09T10:30:00Z",
  finished_at: null,
  result: null,
  changes_detected: null,
  error_code: null,
  error_message: null,
  ...overrides,
})

describe("integration run history", () => {
  test("shows a timeout at the deadline before scheduled cleanup records it", () => {
    expect(runStatus(run(), Date.parse("2026-10-09T10:29:59Z"))).toBe("running")
    expect(runStatus(run(), Date.parse("2026-10-09T10:30:00Z"))).toBe(
      "timed_out",
    )
    expect(runDuration(run(), "timed_out")).toBe("30.0 min")
    expect(runDuration(run(), "running")).toBe("—")
  })

  test("preserves an actual late finish over the inferred timeout", () => {
    const finished = run({
      result: "success",
      finished_at: "2026-10-09T10:35:00Z",
      changes_detected: false,
    })
    expect(runStatus(finished, Date.parse("2026-10-09T12:00:00Z"))).toBe(
      "success",
    )
    expect(runDuration(finished, "success")).toBe("35.0 min")
    expect(runChanges(finished)).toBe("No changes")
  })

  test("does not describe failed or unknown runs as successful unchanged imports", () => {
    expect(runChanges(run({ result: "failure" }))).toBe("—")
    expect(runChanges(run({ result: "success", changes_detected: true }))).toBe(
      "Changes detected",
    )
    expect(runChanges(run({ result: "success" }))).toBe("Changes unknown")
    expect(
      runStatus(
        run({ finished_at: "2026-10-09T10:00:02Z", result: "new_result" }),
        Date.now(),
      ),
    ).toBe("unknown")
    expect(
      runDuration(
        run({ finished_at: "2026-10-09T10:00:02Z", result: "failure" }),
        "failure",
      ),
    ).toBe("2.0 s")
  })
})
