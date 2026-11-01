import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { ArrowLeft, Copy, RefreshCw, Settings } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import {
  ApiError,
  CategoriesService,
  type IntegrationExecutionState,
  type IntegrationPublic,
  IntegrationsService,
  LedgersService,
} from "@/client"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { apiUrl } from "@/config"
import useAuth from "@/hooks/useAuth"
import { usePublicAppConfig } from "@/hooks/usePublicAppConfig"
import { i18n } from "@/i18n"
import { getLocale } from "@/i18n/format"
import { IntegrationForm } from "./IntegrationForm"
import { IntegrationRunHistory } from "./IntegrationRunHistory"
import {
  changesLabel,
  dateTime,
  HealthBadge,
  LoadError,
  resultLabel,
} from "./shared"

const executionLabels: Record<IntegrationExecutionState, string> = {
  get never_run() {
    return i18n.t("app:integrations.never_run")
  },
  get running() {
    return i18n.t("app:integrations.running")
  },
  get timed_out() {
    return i18n.t("app:integrations.timed_out")
  },
  get finished() {
    return i18n.t("app:integrations.finished")
  },
}

function runDuration(startedAt: string | null, finishedAt: string | null) {
  if (!startedAt || !finishedAt) return null
  const seconds = Math.max(
    0,
    (new Date(finishedAt).getTime() - new Date(startedAt).getTime()) / 1000,
  )
  return `${seconds.toLocaleString(getLocale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 })} s`
}

function humanDuration(seconds: number) {
  if (seconds >= 86400 && seconds % 86400 === 0)
    return i18n.t("app:messages.days", { count: seconds / 86400 })
  if (seconds >= 3600 && seconds % 3600 === 0)
    return i18n.t("app:messages.hours", { count: seconds / 3600 })
  if (seconds >= 60 && seconds % 60 === 0)
    return i18n.t("app:messages.minutes", { count: seconds / 60 })
  return i18n.t("app:messages.seconds", { count: seconds })
}

export function IntegrationDetails({
  ledgerId,
  integrationId,
}: {
  ledgerId: string
  integrationId: string
}) {
  useTranslation()

  const { data: config } = usePublicAppConfig()
  const demo = config?.is_demo === true
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<IntegrationPublic | null>(null)
  const [newKey, setNewKey] = useState<string | null>(null)
  const ledger = useQuery({
    queryKey: ["ledger", ledgerId],
    queryFn: () => LedgersService.readLedger({ ledgerId }),
  })
  const integration = useQuery({
    queryKey: ["integration", ledgerId, integrationId],
    queryFn: () =>
      IntegrationsService.getIntegration({ ledgerId, integrationId }),
    refetchInterval: 15_000,
    retry: (count, error) =>
      !(error instanceof ApiError && error.response?.status === 404) &&
      count < 2,
  })
  const categories = useQuery({
    queryKey: ["integration-categories", ledgerId],
    queryFn: () =>
      CategoriesService.readCategories({ ledgerId, includeArchived: true }),
  })
  const item = integration.data
  const category = categories.data?.data.find(
    (entry) => entry.id === item?.category_id,
  )
  const isOwner = !!user && ledger.data?.owner_user_id === user.id
  const notFound =
    integration.error instanceof ApiError &&
    integration.error.response?.status === 404
  const rotate = useMutation({
    mutationFn: () =>
      IntegrationsService.generateIntegrationCredential({
        ledgerId,
        integrationId,
      }),
    onSuccess: (result) => {
      setNewKey(result.connection_key)
      void queryClient.invalidateQueries({
        queryKey: ["integration", ledgerId, integrationId],
      })
    },
  })
  const revoke = useMutation({
    mutationFn: (credentialId: string) =>
      IntegrationsService.revokeIntegrationCredential({
        ledgerId,
        integrationId,
        credentialId,
      }),
    onSuccess: () =>
      void queryClient.invalidateQueries({
        queryKey: ["integration", ledgerId, integrationId],
      }),
  })

  return (
    <div className="min-w-0 space-y-6">
      <Button variant="ghost" size="sm" asChild>
        <Link to="/ledgers/$ledgerId/integrations" params={{ ledgerId }}>
          <ArrowLeft /> {i18n.t("app:integrations.back_to_integrations")}
        </Link>
      </Button>
      {demo && (
        <p
          data-testid="demo-preview-notice"
          className="text-sm text-muted-foreground"
        >
          {i18n.t("app:integrations.demo_preview")}
        </p>
      )}
      {notFound ? (
        <Alert>
          <AlertTitle>
            {i18n.t("app:integrations.integration_not_found")}
          </AlertTitle>
          <AlertDescription>
            {i18n.t(
              "app:integrations.this_instance_is_not_available_in_this_ledger",
            )}
          </AlertDescription>
        </Alert>
      ) : (
        integration.isError && (
          <LoadError
            hasData={!!item}
            retry={() => void integration.refetch()}
          />
        )
      )}
      {integration.isPending && (
        <p role="status">{i18n.t("app:integrations.loading_integration")}</p>
      )}
      {item && !notFound && (
        <>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="break-words text-2xl font-bold tracking-tight">
                  {item.name}
                </h1>
                <HealthBadge health={item.health} />
              </div>
              <p className="break-all text-sm text-muted-foreground">
                {category
                  ? `${category.name} · ${category.code}`
                  : i18n.t("app:integrations.category_unavailable")}
                {" · "}
                {i18n.t("app:integrations.last_success")}{" "}
                {item.last_success_at
                  ? dateTime(item.last_success_at)
                  : i18n.t("app:integrations.never")}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={integration.isFetching}
                onClick={() => {
                  void integration.refetch()
                  void queryClient.invalidateQueries({
                    queryKey: ["integration-runs", ledgerId, integrationId],
                  })
                }}
              >
                <RefreshCw /> {i18n.t("app:integrations.refresh")}
              </Button>
              {isOwner && (
                <Button
                  disabled={integration.isError || integration.isFetching}
                  onClick={() => setEditing(item)}
                >
                  <Settings /> {i18n.t("app:integrations.configure")}
                </Button>
              )}
            </div>
          </div>

          {!item.enabled && (
            <Alert>
              <AlertTitle>
                {i18n.t("app:integrations.reporting_disabled")}
              </AlertTitle>
              <AlertDescription>
                {i18n.t(
                  "app:integrations.new_runs_cannot_report_a_start_an_already_accepted_run_may_still_finish_the_external_",
                )}
              </AlertDescription>
            </Alert>
          )}
          {item.is_stale && (
            <Alert variant="destructive">
              <AlertTitle>
                {i18n.t("app:integrations.report_overdue")}
              </AlertTitle>
              <AlertDescription>
                {i18n.t(
                  "app:integrations.no_completed_report_has_arrived_within_the_configured_time_a_new_running_attempt_does",
                )}
              </AlertDescription>
            </Alert>
          )}
          {item.execution_state === "timed_out" && (
            <Alert variant={item.enabled ? "destructive" : "default"}>
              <AlertTitle>
                {i18n.t("app:integrations.run_timed_out")}
              </AlertTitle>
              <AlertDescription>
                {i18n.t(
                  "app:integrations.the_last_started_run_did_not_report_completion_before_its_deadline_ledger_does_not_st",
                )}
              </AlertDescription>
            </Alert>
          )}

          <Card className="min-w-0">
            <CardHeader>
              <CardTitle>{i18n.t("app:integrations.latest_run")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {item.last_finished_at ? (
                <div className="flex items-start gap-3">
                  <span
                    className={
                      item.last_result === "failure"
                        ? "text-destructive"
                        : "text-emerald-600"
                    }
                    aria-hidden="true"
                  >
                    {item.last_result === "failure" ? "✕" : "✓"}
                  </span>
                  <div className="min-w-0 space-y-1">
                    <p className="font-medium">{resultLabel(item)}</p>
                    <p className="text-sm text-muted-foreground">
                      {changesLabel(item)}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {dateTime(item.last_finished_at)}
                      {runDuration(
                        item.current_started_at,
                        item.current_finished_at,
                      ) &&
                        i18n.t("app:integrations.duration_0ef728", {
                          value1: runDuration(
                            item.current_started_at,
                            item.current_finished_at,
                          ),
                        })}
                    </p>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {i18n.t("app:integrations.no_completed_runs_yet")}
                </p>
              )}

              {item.last_error_message && (
                <Alert variant="destructive" className="min-w-0">
                  <AlertTitle className="break-all">
                    {i18n.t("app:integrations.last_error")}
                    {item.last_error_code ? ` · ${item.last_error_code}` : ""}
                  </AlertTitle>
                  <AlertDescription>
                    <p className="whitespace-pre-wrap break-all">
                      {item.last_error_message}
                    </p>
                  </AlertDescription>
                </Alert>
              )}

              <details className="min-w-0">
                <summary className="cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground">
                  {i18n.t("app:integrations.show_technical_details")}
                </summary>
                <div className="mt-4 rounded-lg border p-4">
                  <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
                    <div>
                      <dt className="text-muted-foreground">
                        {i18n.t("app:integrations.execution")}
                      </dt>
                      <dd>{executionLabels[item.execution_state]}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">
                        {i18n.t("app:integrations.started_at")}
                      </dt>
                      <dd>{dateTime(item.current_started_at)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">
                        {i18n.t("app:integrations.finished_at")}
                      </dt>
                      <dd>{dateTime(item.current_finished_at)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">
                        {i18n.t("app:integrations.deadline")}
                      </dt>
                      <dd>{dateTime(item.current_deadline_at)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">
                        {i18n.t("app:integrations.run_timeout")}
                      </dt>
                      <dd>{humanDuration(item.run_timeout_seconds)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">
                        {i18n.t("app:integrations.report_overdue_after")}
                      </dt>
                      <dd>{humanDuration(item.stale_after_seconds)}</dd>
                    </div>
                    <div className="min-w-0 sm:col-span-2 lg:col-span-3">
                      <dt className="text-muted-foreground">
                        {i18n.t("app:integrations.run_id")}
                      </dt>
                      <dd className="break-all font-mono">
                        {item.current_run_id ??
                          i18n.t("app:integrations.no_run_yet")}
                      </dd>
                    </div>
                  </dl>
                </div>
              </details>
            </CardContent>
          </Card>

          <IntegrationRunHistory
            key={`${ledgerId}:${integrationId}`}
            ledgerId={ledgerId}
            integrationId={integrationId}
          />

          <Card className="min-w-0">
            <CardHeader>
              <CardTitle>{i18n.t("app:integrations.connection")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {demo && (
                <p
                  id="integration-credentials-demo"
                  className="text-sm text-muted-foreground"
                >
                  {i18n.t("app:integrations.demo_credentials")}
                </p>
              )}
              {newKey && (
                <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <h3 className="font-semibold">
                        {i18n.t("app:integrations.connection_key_created")}
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        {i18n.t(
                          "app:integrations.save_this_key_now_it_will_not_be_shown_again",
                        )}
                      </p>
                    </div>
                    <span className="rounded-full border bg-background px-2.5 py-1 text-xs font-medium">
                      {i18n.t("app:integrations.shown_once")}
                    </span>
                  </div>

                  <div className="mt-4 rounded-md border bg-background p-3">
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {i18n.t("app:integrations.api_key")}
                    </p>
                    <code className="block break-all text-sm">{newKey}</code>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button
                      onClick={() => void navigator.clipboard.writeText(newKey)}
                    >
                      <Copy /> {i18n.t("app:integrations.copy_key")}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() =>
                        void navigator.clipboard.writeText(
                          `OBLIDOG_URL=${apiUrl}\nOBLIDOG_API_KEY=${newKey}\n`,
                        )
                      }
                    >
                      <Copy />{" "}
                      {i18n.t("app:integrations.copy_env_configuration")}
                    </Button>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-medium">
                    {item.credentials.some(
                      (credential) => !credential.revoked_at,
                    )
                      ? i18n.t("app:integrations.connection_key_active")
                      : i18n.t("app:integrations.no_active_connection_key")}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {i18n.t(
                      "app:integrations.used_by_the_external_integration_runner_to_access_this_category",
                    )}
                  </p>
                </div>
                {isOwner && (
                  <Button
                    variant="outline"
                    onClick={() => rotate.mutate()}
                    disabled={!config || demo || rotate.isPending}
                    aria-describedby={
                      demo ? "integration-credentials-demo" : undefined
                    }
                  >
                    {i18n.t("app:integrations.generate_new_key")}
                  </Button>
                )}
              </div>

              {item.credentials.map((credential) => (
                <div
                  key={credential.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"
                >
                  <span>
                    {credential.key_prefix}
                    {i18n.t("app:integrations.created")}{" "}
                    {dateTime(credential.created_at)}
                    {credential.revoked_at
                      ? i18n.t("app:integrations.revoked")
                      : ""}
                  </span>
                  {isOwner && !credential.revoked_at && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!config || demo || revoke.isPending}
                      aria-describedby={
                        demo ? "integration-credentials-demo" : undefined
                      }
                      onClick={() => revoke.mutate(credential.id)}
                    >
                      {i18n.t("app:integrations.revoke_key")}
                    </Button>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>

          <p className="text-sm text-muted-foreground">
            {i18n.t(
              "app:integrations.status_refreshes_every_15_seconds_execution_and_scheduling_are_managed_by_the_externa",
            )}
          </p>
        </>
      )}
      {editing && isOwner && (
        <IntegrationForm
          ledgerId={ledgerId}
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={() => setEditing(null)}
        />
      )}
    </div>
  )
}
