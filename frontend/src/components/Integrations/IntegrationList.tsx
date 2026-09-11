import { useQuery } from "@tanstack/react-query"
import { Link, useNavigate } from "@tanstack/react-router"
import { Plus, RefreshCw } from "lucide-react"
import { useState } from "react"

import {
  CategoriesService,
  IntegrationsService,
  LedgersService,
} from "@/client"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
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
  const [connectionKey, setConnectionKey] = useState<string | null>(null)
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
  const categories = useQuery({
    queryKey: ["integration-categories", ledgerId],
    queryFn: () => CategoriesService.readCategories({ ledgerId }),
  })
  const isOwner = !!user && ledger.data?.owner_user_id === user.id
  const categoryNames = new Map(
    categories.data?.data.map((category) => [category.id, category.name]),
  )

  return (
    <div className="min-w-0 space-y-6">
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
        <div className="rounded-lg border border-dashed p-8 text-center">
          <h2 className="font-semibold">No integrations yet</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {isOwner
              ? "Add an integration here, then copy its connection key into the runner configuration."
              : "The ledger owner can register integrations here. Their status will appear after the runners start reporting."}
          </p>
        </div>
      )}
      {connectionKey && (
        <Card>
          <CardHeader>
            <CardTitle>Connection key</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-destructive">
              Copy this key now. It will not be displayed again.
            </p>
            <code className="block break-all rounded-md border p-3 text-sm">
              {connectionKey}
            </code>
            <Button
              variant="outline"
              onClick={() =>
                void navigator.clipboard.writeText(
                  `OBLIDOG_URL=${window.location.origin}\nOBLIDOG_API_KEY=${connectionKey}\n`,
                )
              }
            >
              Copy configuration
            </Button>
            <Button variant="ghost" onClick={() => setConnectionKey(null)}>
              I copied the key
            </Button>
          </CardContent>
        </Card>
      )}
      {integrations.data && integrations.data.count > 0 && (
        <div className="overflow-hidden rounded-lg border">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead>Integration</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last run</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead>Changes</TableHead>
                  <TableHead className="w-24 text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {integrations.data.data.map((item) => (
                  <TableRow key={item.id} className="group">
                    <TableCell className="min-w-52">
                      <Link
                        className="font-medium hover:underline"
                        to="/ledgers/$ledgerId/integrations/$integrationId"
                        params={{ ledgerId, integrationId: item.id }}
                      >
                        {item.name}
                      </Link>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {item.enabled ? "Enabled" : "Disabled"}
                      </p>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {categoryNames.get(item.category_id) ?? item.category_id}
                    </TableCell>
                    <TableCell>
                      <HealthBadge health={item.health} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {dateTime(item.last_finished_at)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {resultLabel(item)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      {changesLabel(item)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" asChild>
                        <Link
                          to="/ledgers/$ledgerId/integrations/$integrationId"
                          params={{ ledgerId, integrationId: item.id }}
                        >
                          View
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
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
          onSaved={(item, key) => {
            setCreating(false)
            setConnectionKey(key ?? null)
            if (!key) {
              void navigate({
                to: "/ledgers/$ledgerId/integrations/$integrationId",
                params: { ledgerId, integrationId: item.id },
              })
            }
          }}
        />
      )}
    </div>
  )
}
