import { useQuery } from "@tanstack/react-query"
import { Link, useNavigate } from "@tanstack/react-router"
import { Plus, RefreshCw } from "lucide-react"
import { useState } from "react"

import { IntegrationsService, LedgersService } from "@/client"
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

const PAGE_SIZE = 24

export function IntegrationList({ ledgerId }: { ledgerId: string }) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [page, setPage] = useState(0)
  const [creating, setCreating] = useState(false)
  const ledger = useQuery({
    queryKey: ["ledger", ledgerId],
    queryFn: () => LedgersService.readLedger({ ledgerId }),
  })
  const integrations = useQuery({
    queryKey: ["integrations", ledgerId, page],
    queryFn: () =>
      IntegrationsService.listIntegrations({
        ledgerId,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      }),
    refetchInterval: 15_000,
  })
  const isOwner = !!user && ledger.data?.owner_user_id === user.id

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Integrations</h1>
          <p className="mt-1 text-muted-foreground">
            Monitor external integrations for{" "}
            {ledger.data?.name ?? "this ledger"}.
          </p>
          {!isOwner && (
            <p className="mt-1 text-sm text-muted-foreground">
              Only the ledger owner can change configuration.
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => void integrations.refetch()}
            disabled={integrations.isFetching}
          >
            <RefreshCw /> Refresh
          </Button>
          {isOwner && (
            <Button onClick={() => setCreating(true)}>
              <Plus /> Add integration
            </Button>
          )}
        </div>
      </div>
      {integrations.isError && (
        <LoadError
          hasData={!!integrations.data}
          retry={() => void integrations.refetch()}
        />
      )}
      {integrations.isPending && <p role="status">Loading integrations…</p>}
      {integrations.data?.count === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>No integrations yet</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {isOwner
              ? "Add an instance here, then configure its runner to report using the instance key and this ledger’s API key."
              : "The ledger owner can register integrations here. Their status will appear after the runners start reporting."}
          </CardContent>
        </Card>
      )}
      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        {integrations.data?.data.map((item) => (
          <Card key={item.id} className="min-w-0">
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <CardTitle className="min-w-0 break-words">
                  <Link
                    className="hover:underline"
                    to="/ledgers/$ledgerId/integrations/$integrationId"
                    params={{ ledgerId, integrationId: item.id }}
                  >
                    {item.name}
                  </Link>
                </CardTitle>
                <HealthBadge health={item.health} />
              </div>
              <p className="break-all text-sm text-muted-foreground">
                {item.provider} · {item.key}
              </p>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <dt className="text-muted-foreground">Last success</dt>
                  <dd>
                    {item.last_success_at
                      ? dateTime(item.last_success_at)
                      : "No success yet"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Last result</dt>
                  <dd>{resultLabel(item)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">
                    Changes in last result
                  </dt>
                  <dd>{changesLabel(item)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Last report</dt>
                  <dd>{dateTime(item.last_finished_at)}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        ))}
      </div>
      {((integrations.data?.count ?? 0) > PAGE_SIZE || page > 0) && (
        <nav
          aria-label="Integration pages"
          className="flex flex-wrap items-center justify-between gap-2"
        >
          <Button
            variant="outline"
            disabled={page === 0 || integrations.isFetching}
            onClick={() => setPage((value) => value - 1)}
          >
            Previous
          </Button>
          <span className="text-sm">Page {page + 1}</span>
          <Button
            variant="outline"
            disabled={
              !integrations.data ||
              (page + 1) * PAGE_SIZE >= integrations.data.count ||
              integrations.isFetching
            }
            onClick={() => setPage((value) => value + 1)}
          >
            Next
          </Button>
        </nav>
      )}
      {creating && isOwner && (
        <IntegrationForm
          ledgerId={ledgerId}
          onClose={() => setCreating(false)}
          onSaved={(item) => {
            setCreating(false)
            void navigate({
              to: "/ledgers/$ledgerId/integrations/$integrationId",
              params: { ledgerId, integrationId: item.id },
            })
          }}
        />
      )}
    </div>
  )
}
