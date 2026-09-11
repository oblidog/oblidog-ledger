import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { ArrowLeft, RefreshCw, Settings } from "lucide-react"
import { useState } from "react"

import {
  ApiError,
  CategoriesService,
  type IntegrationExecutionState,
  type IntegrationPublic,
  IntegrationsService,
  LedgersService,
} from "@/client"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import useAuth from "@/hooks/useAuth"
import { IntegrationForm } from "./IntegrationForm"
import {
  changesLabel,
  dateTime,
  HealthBadge,
  LoadError,
  resultLabel,
} from "./shared"

const executionLabels: Record<IntegrationExecutionState, string> = {
  never_run: "Never run",
  running: "Running",
  timed_out: "Timed out",
  finished: "Finished",
}

export function IntegrationDetails({
  ledgerId,
  integrationId,
}: {
  ledgerId: string
  integrationId: string
}) {
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
          <ArrowLeft /> Back to integrations
        </Link>
      </Button>
      {notFound ? (
        <Alert>
          <AlertTitle>Integration not found</AlertTitle>
          <AlertDescription>
            This instance is not available in this ledger.
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
      {integration.isPending && <p role="status">Loading integration…</p>}
      {item && !notFound && (
        <>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 space-y-2">
              <h1 className="break-words text-2xl font-bold tracking-tight">
                {item.name}
              </h1>
              <p className="break-all text-sm text-muted-foreground">
                Connection key managed on this integration
              </p>
              <HealthBadge health={item.health} />
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={integration.isFetching}
                onClick={() => void integration.refetch()}
              >
                <RefreshCw /> Refresh
              </Button>
              {isOwner && (
                <Button
                  disabled={integration.isError || integration.isFetching}
                  onClick={() => setEditing(item)}
                >
                  <Settings /> Configure
                </Button>
              )}
            </div>
          </div>
          {!item.enabled && (
            <Alert>
              <AlertTitle>Reporting disabled</AlertTitle>
              <AlertDescription>
                New runs cannot report a start. An already accepted run may
                still finish. The external container and its API key remain
                active.
              </AlertDescription>
            </Alert>
          )}
          {item.is_stale && (
            <Alert variant="destructive">
              <AlertTitle>Report overdue</AlertTitle>
              <AlertDescription>
                No completed report has arrived within the configured time. A
                new running attempt does not clear this warning.
              </AlertDescription>
            </Alert>
          )}
          {item.execution_state === "timed_out" && (
            <Alert variant={item.enabled ? "destructive" : "default"}>
              <AlertTitle>Run timed out</AlertTitle>
              <AlertDescription>
                The last started run did not report completion before its
                deadline. Ledger does not stop the external process.
              </AlertDescription>
            </Alert>
          )}
          <div className="grid min-w-0 gap-4 lg:grid-cols-2">
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>Connection keys</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {isOwner && (
                  <Button
                    onClick={() => rotate.mutate()}
                    disabled={rotate.isPending}
                  >
                    Generate new key
                  </Button>
                )}
                {newKey && (
                  <Alert>
                    <AlertTitle>Copy this connection key now</AlertTitle>
                    <AlertDescription className="space-y-2">
                      <code className="block break-all">{newKey}</code>
                      <p>It will not be displayed again.</p>
                      <Button
                        variant="outline"
                        onClick={() =>
                          void navigator.clipboard.writeText(
                            `OBLIDOG_URL=${window.location.origin}\nOBLIDOG_API_KEY=${newKey}\n`,
                          )
                        }
                      >
                        Copy configuration
                      </Button>
                    </AlertDescription>
                  </Alert>
                )}
                {item.credentials.map((credential) => (
                  <div
                    key={credential.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"
                  >
                    <span>
                      {credential.key_prefix}… · created{" "}
                      {dateTime(credential.created_at)}
                      {credential.revoked_at ? " · revoked" : ""}
                    </span>
                    {isOwner && !credential.revoked_at && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => revoke.mutate(credential.id)}
                      >
                        Revoke key
                      </Button>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>Last completed result</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid gap-4 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-muted-foreground">Result</dt>
                    <dd>{resultLabel(item)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Changes</dt>
                    <dd>{changesLabel(item)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Completed at</dt>
                    <dd>{dateTime(item.last_finished_at)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Last success</dt>
                    <dd>
                      {item.last_success_at
                        ? dateTime(item.last_success_at)
                        : "No success yet"}
                    </dd>
                  </div>
                </dl>
                {item.last_error_message && (
                  <Alert variant="destructive" className="mt-4 min-w-0">
                    <AlertTitle className="break-all">
                      Last error
                      {item.last_error_code ? ` · ${item.last_error_code}` : ""}
                    </AlertTitle>
                    <AlertDescription>
                      <p className="whitespace-pre-wrap break-all">
                        {item.last_error_message}
                      </p>
                    </AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </Card>
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>Latest run</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid gap-4 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-muted-foreground">Execution</dt>
                    <dd>{executionLabels[item.execution_state]}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Started at</dt>
                    <dd>{dateTime(item.current_started_at)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Deadline</dt>
                    <dd>{dateTime(item.current_deadline_at)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Finished at</dt>
                    <dd>{dateTime(item.current_finished_at)}</dd>
                  </div>
                  <div className="min-w-0 sm:col-span-2">
                    <dt className="text-muted-foreground">Run ID</dt>
                    <dd className="break-all font-mono">
                      {item.current_run_id ?? "No run yet"}
                    </dd>
                  </div>
                </dl>
              </CardContent>
            </Card>
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>Configuration</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <dl className="grid gap-4 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-muted-foreground">Reporting</dt>
                    <dd>{item.enabled ? "Enabled" : "Disabled"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Run timeout</dt>
                    <dd>{item.run_timeout_seconds.toLocaleString()} seconds</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">
                      Report overdue after
                    </dt>
                    <dd>{item.stale_after_seconds.toLocaleString()} seconds</dd>
                  </div>
                </dl>
                {!isOwner && (
                  <p className="text-sm text-muted-foreground">
                    Only the ledger owner can change configuration.
                  </p>
                )}
              </CardContent>
            </Card>
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>Associated categories</CardTitle>
              </CardHeader>
              <CardContent>
                {categories.isError ? (
                  <div role="alert" className="space-y-2 text-sm">
                    <p>Could not load category names.</p>
                    <Button
                      variant="outline"
                      onClick={() => void categories.refetch()}
                    >
                      Retry categories
                    </Button>
                  </div>
                ) : categories.isPending ? (
                  <p className="text-sm">Loading categories…</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {(() => {
                      const category = categories.data.data.find(
                        (entry) => entry.id === item.category_id,
                      )
                      return (
                        <Badge
                          key={item.category_id}
                          variant="outline"
                          className="max-w-full whitespace-normal break-all"
                        >
                          {category
                            ? `${category.name} (${category.code})${category.archived_at ? " · archived" : ""}`
                            : "Unavailable category"}
                        </Badge>
                      )
                    })()}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
          <p className="text-sm text-muted-foreground">
            Status refreshes every 15 seconds. Execution and scheduling are
            managed by the external runner.
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
