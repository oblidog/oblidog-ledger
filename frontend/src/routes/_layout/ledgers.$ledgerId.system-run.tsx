import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { AlertCircle, ArrowLeft, Play, XCircle } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import {
  type SystemRunPublic,
  type SystemRunStepPublic,
  SystemRunsService,
} from "@/client"
import { DemoPreviewNotice } from "@/components/Common/DemoRestrictedSection"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { LoadingButton } from "@/components/ui/loading-button"
import { demoSystemRuns, demoSystemTasks } from "@/demoPreview"
import useCustomToast from "@/hooks/useCustomToast"
import { usePublicAppConfig } from "@/hooks/usePublicAppConfig"
import { i18n } from "@/i18n"
import { domainLabel } from "@/i18n/domainLabels"
import { getLocale } from "@/i18n/format"
import { handleError } from "@/utils"

export const Route = createFileRoute("/_layout/ledgers/$ledgerId/system-run")({
  component: SystemRun,
  head: () => ({ meta: [{ title: i18n.t("app:system.system_run_oblidog") }] }),
})

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(getLocale(), {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(value))
}

function statusVariant(status: SystemRunPublic["status"]) {
  if (status === "success") return "default"
  if (status === "running") return "secondary"
  return "destructive"
}

function formatDuration(startedAt: string, finishedAt: string | null) {
  if (!finishedAt) return null

  const milliseconds =
    new Date(finishedAt).getTime() - new Date(startedAt).getTime()
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return null

  if (milliseconds < 1_000) return `${milliseconds} ms`

  const seconds = Math.floor(milliseconds / 1_000)
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return minutes > 0
    ? `${minutes}m ${remainingSeconds}s`
    : `${remainingSeconds}s`
}

function formatSummaryKey(key: string) {
  return domainLabel("summaryField", key)
}

function formatSummaryValue(value: unknown) {
  if (typeof value === "string" || typeof value === "number")
    return String(value)
  if (typeof value === "boolean")
    return value ? i18n.t("app:system.yes") : i18n.t("app:system.no")
  if (value === null) return i18n.t("app:system.none")
  return JSON.stringify(value)
}

const summaryLabels: Record<string, Record<string, string>> = {
  ensure_obligations: {
    get created_obligations() {
      return i18n.t("app:system.created_obligations")
    },
  },
  scheduled_reports: {
    get sent() {
      return i18n.t("app:system.reports_sent")
    },
    get skipped() {
      return i18n.t("app:system.reports_skipped")
    },
    get failed() {
      return i18n.t("app:system.reports_failed")
    },
  },
  legacy_import: {
    get created_category_groups() {
      return i18n.t("app:system.created_category_groups")
    },
    get created_categories() {
      return i18n.t("app:system.created_categories")
    },
    get replaced_categories() {
      return i18n.t("app:system.replaced_categories")
    },
    get imported_obligations() {
      return i18n.t("app:system.imported_obligations")
    },
  },
}

function StepSummary({ step }: { step: SystemRunStepPublic }) {
  useTranslation()

  if (!step.summary || Object.keys(step.summary).length === 0) return null

  const labels = summaryLabels[step.task_name] ?? {}
  const entries = Object.entries(step.summary)
  const knownEntries = entries.filter(([key]) => labels[key])
  const additionalEntries = entries.filter(([key]) => !labels[key])

  return (
    <div className="space-y-2 text-sm">
      {knownEntries.length > 0 && (
        <dl className="space-y-1">
          {knownEntries.map(([key, value]) => (
            <div
              className="flex items-baseline justify-between gap-3"
              key={key}
            >
              <dt className="text-muted-foreground">{labels[key]}</dt>
              <dd className="font-medium">{formatSummaryValue(value)}</dd>
            </div>
          ))}
        </dl>
      )}
      {additionalEntries.length > 0 && (
        <details className="rounded-md border px-3 py-2">
          <summary className="cursor-pointer font-medium">
            {knownEntries.length > 0
              ? i18n.t("app:system.additional_details")
              : i18n.t("app:system.step_details")}
          </summary>
          <dl className="mt-2 space-y-1">
            {additionalEntries.map(([key, value]) => (
              <div className="flex flex-wrap justify-between gap-x-3" key={key}>
                <dt className="text-muted-foreground">
                  {formatSummaryKey(key)}
                </dt>
                <dd className="break-all text-right">
                  {formatSummaryValue(value)}
                </dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </div>
  )
}

function SystemRun() {
  useTranslation()

  const { data: config } = usePublicAppConfig()
  const demo = config?.is_demo === true
  const { ledgerId } = Route.useParams()
  const queryClient = useQueryClient()
  const { showErrorToast, showSuccessToast } = useCustomToast()
  const [confirmationOpen, setConfirmationOpen] = useState(false)
  const [manualTaskNames, setManualTaskNames] = useState<string[]>([])
  const tasks = useQuery({
    queryKey: ["system-run-tasks", demo],
    enabled: !!config,
    queryFn: () =>
      demo
        ? Promise.resolve(demoSystemTasks)
        : SystemRunsService.readSystemRunTasks(),
  })
  const history = useQuery({
    queryKey: ["system-runs", demo, demo ? ledgerId : null],
    enabled: !!config,
    queryFn: () =>
      demo
        ? Promise.resolve(demoSystemRuns(ledgerId))
        : SystemRunsService.readSystemRuns(),
    refetchInterval: (query) =>
      query.state.data?.data.some((run) => run.status === "running")
        ? 1_000
        : false,
  })
  const startRun = useMutation({
    mutationFn: () =>
      SystemRunsService.startSystemRun({
        requestBody:
          manualTaskNames.length > 0
            ? { manual_task_names: manualTaskNames }
            : undefined,
      }),
    onError: handleError.bind(showErrorToast),
    onSuccess: (run) => {
      queryClient.setQueryData(
        ["system-runs", demo, demo ? ledgerId : null],
        (previous: typeof history.data) =>
          previous
            ? { ...previous, data: [run, ...previous.data] }
            : { data: [run], count: 1 },
      )
      setConfirmationOpen(false)
      showSuccessToast(
        i18n.t("app:system.system_run_finished_with", {
          value1: domainLabel("runStatus", run.status),
        }),
      )
    },
  })

  const toggleManualTask = (name: string, checked: boolean) => {
    setManualTaskNames((previous) =>
      checked ? [...previous, name] : previous.filter((task) => task !== name),
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <Button variant="ghost" size="sm" className="w-fit" asChild>
          <Link to="/ledgers/$ledgerId" params={{ ledgerId }}>
            <ArrowLeft />
            {i18n.t("app:system.back_to_workspace")}
          </Link>
        </Button>
        <div>
          <div className="mb-2 flex items-center gap-2">
            <Play className="size-5 text-primary" />
            <Badge variant="outline">
              {i18n.t("app:system.administrator")}
            </Badge>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">
            {i18n.t("app:system.system_run")}
          </h1>
          <p className="mt-1 text-muted-foreground">
            {i18n.t(
              "app:system.run_scheduled_maintenance_tasks_and_inspect_their_history",
            )}
          </p>
        </div>
      </div>

      {demo && <DemoPreviewNotice />}
      <Card>
        <CardHeader>
          <CardTitle>{i18n.t("app:system.start_manual_run")}</CardTitle>
          <CardDescription>
            {i18n.t(
              "app:system.run_all_scheduled_tasks_optionally_selecting_manual_only_tasks_disabled_tasks_cannot_",
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {tasks.isError ? (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertTitle>
                {i18n.t("app:system.could_not_load_system_run_tasks")}
              </AlertTitle>
              <AlertDescription>
                {i18n.t(
                  "app:system.only_administrators_can_start_a_system_run",
                )}
              </AlertDescription>
            </Alert>
          ) : (
            <>
              {tasks.data && (
                <div className="space-y-3">
                  <p className="text-sm font-medium">
                    {i18n.t("app:system.configured_tasks")}
                  </p>
                  {tasks.data.map((task) => (
                    <div className="flex items-center gap-2" key={task.name}>
                      {task.mode === "manual_only" ? (
                        <>
                          <Checkbox
                            id={`system-run-task-${task.name}`}
                            disabled={!config || demo}
                            checked={manualTaskNames.includes(task.name)}
                            onCheckedChange={(checked) =>
                              toggleManualTask(task.name, checked === true)
                            }
                          />
                          <Label htmlFor={`system-run-task-${task.name}`}>
                            {domainLabel("task", task.name)}
                          </Label>
                        </>
                      ) : (
                        <span className="text-sm">
                          {domainLabel("task", task.name)}
                        </span>
                      )}
                      <Badge variant="outline" className="ml-auto">
                        {task.mode === "scheduled"
                          ? i18n.t("app:system.included_in_run_all")
                          : task.mode === "manual_only"
                            ? i18n.t("app:system.select_to_include")
                            : domainLabel("runMode", "disabled")}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
              <Dialog
                open={confirmationOpen}
                onOpenChange={setConfirmationOpen}
              >
                <DialogTrigger asChild>
                  <Button
                    disabled={
                      !config || demo || tasks.isLoading || startRun.isPending
                    }
                  >
                    <Play /> {i18n.t("app:system.start_system_run")}
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>
                      {i18n.t("app:system.start_system_run_302b29")}
                    </DialogTitle>
                    <DialogDescription>
                      {i18n.t(
                        "app:system.scheduled_tasks_will_run_now_manual_only_tasks_run_only_when_selected_above",
                      )}
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <DialogClose asChild>
                      <Button variant="outline" disabled={startRun.isPending}>
                        {i18n.t("app:system.cancel")}
                      </Button>
                    </DialogClose>
                    <LoadingButton
                      loading={startRun.isPending}
                      onClick={() => startRun.mutate()}
                    >
                      {i18n.t("app:system.start_run")}
                    </LoadingButton>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{i18n.t("app:system.run_history")}</CardTitle>
          <CardDescription>
            {i18n.t(
              "app:system.includes_every_task_and_ledger_outcome_including_skipped_work",
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {history.isLoading ? (
            <p className="text-sm text-muted-foreground">
              {i18n.t("app:system.loading_history")}
            </p>
          ) : history.isError ? (
            <Alert variant="destructive">
              <XCircle />
              <AlertTitle>
                {i18n.t("app:system.could_not_load_system_run_history")}
              </AlertTitle>
              <AlertDescription>
                {i18n.t("app:system.refresh_the_page_and_try_again")}
              </AlertDescription>
            </Alert>
          ) : history.data?.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {i18n.t("app:system.no_system_runs_yet")}
            </p>
          ) : (
            history.data?.data.map((run) => (
              <section className="rounded-lg border p-4" key={run.id}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">
                      {formatDateTime(run.effective_at)}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {domainLabel("runMode", run.trigger)} · {run.timezone} ·{" "}
                      {run.business_date}
                    </p>
                  </div>
                  <Badge variant={statusVariant(run.status)}>
                    {domainLabel("runStatus", run.status)}
                  </Badge>
                </div>
                {run.error && (
                  <p className="mt-3 text-sm text-destructive">{run.error}</p>
                )}
                {run.summary && (
                  <p className="mt-3 text-sm text-muted-foreground">
                    {String(run.summary.succeeded_steps ?? 0)}{" "}
                    {i18n.t("app:system.succeeded")}{" "}
                    {String(run.summary.failed_steps ?? 0)}{" "}
                    {i18n.t("app:system.failed")}{" "}
                    {String(run.summary.skipped_steps ?? 0)}{" "}
                    {i18n.t("app:system.skipped")}
                  </p>
                )}
                <div className="mt-4 space-y-2">
                  {run.steps?.map((step) => {
                    const duration = formatDuration(
                      step.started_at,
                      step.finished_at,
                    )
                    return (
                      <div
                        className="rounded-md border p-3 text-sm"
                        key={step.id}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <span className="font-medium">
                            {domainLabel("task", step.task_name)}
                            {step.ledger_id ? ` · ${step.ledger_id}` : ""}
                          </span>
                          <span className="text-muted-foreground">
                            {domainLabel("runStatus", step.status)}
                            {duration ? ` · ${duration}` : ""}
                          </span>
                        </div>
                        {step.skip_reason && (
                          <p className="mt-2 text-muted-foreground">
                            {i18n.t("app:system.skip_reason")}{" "}
                            {domainLabel("skipReason", step.skip_reason)}
                          </p>
                        )}
                        {step.error && (
                          <p className="mt-2 text-destructive">{step.error}</p>
                        )}
                        {step.summary &&
                          Object.keys(step.summary).length > 0 && (
                            <div className="mt-2">
                              <StepSummary step={step} />
                            </div>
                          )}
                      </div>
                    )
                  })}
                </div>
              </section>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  )
}
