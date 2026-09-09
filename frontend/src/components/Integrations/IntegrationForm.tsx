import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import {
  ApiError,
  CategoriesService,
  type IntegrationCreate,
  type IntegrationPublic,
  IntegrationsService,
} from "@/client"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LoadingButton } from "@/components/ui/loading-button"
import useCustomToast from "@/hooks/useCustomToast"

// Mount a fresh form for each edit session. Polling must not replace its revision
// or unsaved values while the owner is making changes.
export function IntegrationForm({
  ledgerId,
  initial,
  onClose,
  onSaved,
}: {
  ledgerId: string
  initial?: IntegrationPublic
  onClose: () => void
  onSaved: (item: IntegrationPublic) => void
}) {
  const queryClient = useQueryClient()
  const { showSuccessToast } = useCustomToast()
  const [name, setName] = useState(initial?.name ?? "")
  const [key, setKey] = useState(initial?.key ?? "")
  const [provider, setProvider] = useState(initial?.provider ?? "")
  const [enabled, setEnabled] = useState(initial?.enabled ?? true)
  const [staleSeconds, setStaleSeconds] = useState(
    String(initial?.stale_after_seconds ?? 93600),
  )
  const [timeoutSeconds, setTimeoutSeconds] = useState(
    String(initial?.run_timeout_seconds ?? 1800),
  )
  const [categoryIds, setCategoryIds] = useState(initial?.category_ids ?? [])
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)
  const categories = useQuery({
    queryKey: ["integration-categories", ledgerId],
    queryFn: () =>
      CategoriesService.readCategories({ ledgerId, includeArchived: true }),
  })
  const save = useMutation({
    mutationFn: (body: IntegrationCreate) =>
      initial
        ? IntegrationsService.updateIntegration({
            ledgerId,
            integrationId: initial.id,
            requestBody: {
              expected_revision: initial.revision,
              name: body.name,
              enabled: body.enabled,
              category_ids: body.category_ids,
              stale_after_seconds: body.stale_after_seconds,
              run_timeout_seconds: body.run_timeout_seconds,
            },
          })
        : IntegrationsService.createIntegration({
            ledgerId,
            requestBody: body,
          }),
    onSuccess: (item) => {
      queryClient.setQueryData(["integration", ledgerId, item.id], item)
      void queryClient.invalidateQueries({
        queryKey: ["integrations", ledgerId],
      })
      showSuccessToast(initial ? "Integration updated" : "Integration created")
      onSaved(item)
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        const detail = err.response?.data?.detail
        if (detail?.code === "revision_conflict") {
          setConflict(true)
          setError(
            "This integration changed while you were editing. Close this form and reopen configuration to review the latest values before saving.",
          )
          void queryClient.invalidateQueries({
            queryKey: ["integration", ledgerId, initial?.id],
          })
          void queryClient.invalidateQueries({
            queryKey: ["integrations", ledgerId],
          })
          return
        }
        if (detail?.code === "duplicate_key") {
          setError(
            "This key is already used in this ledger. Choose a different key.",
          )
          return
        }
        if (typeof detail === "string") {
          setError(detail)
          return
        }
        if (Array.isArray(detail) && typeof detail[0]?.msg === "string") {
          setError(detail[0].msg)
          return
        }
      }
      setError(
        "Could not save the integration. Check your connection and try again.",
      )
    },
  })

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !save.isPending) onClose()
      }}
    >
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {initial ? "Configure integration" : "Add integration"}
          </DialogTitle>
          <DialogDescription>
            {initial
              ? "Changes to the run timeout apply to future runs."
              : "Register an instance before enabling reporting in its runner."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            setError(null)
            const stale = Number(staleSeconds)
            const timeout = Number(timeoutSeconds)
            if (!name.trim()) {
              setError("Enter an integration name.")
              return
            }
            if (
              ![stale, timeout].every(
                (value) =>
                  Number.isInteger(value) && value > 0 && value <= 2147483647,
              ) ||
              timeout >= stale
            ) {
              setError(
                "Use positive whole seconds. Run timeout must be shorter than the report overdue threshold.",
              )
              return
            }
            save.mutate({
              name: name.trim(),
              key,
              provider,
              enabled,
              category_ids: categoryIds,
              stale_after_seconds: stale,
              run_timeout_seconds: timeout,
            })
          }}
        >
          <fieldset disabled={save.isPending || conflict} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="integration-name">Name</Label>
              <Input
                id="integration-name"
                required
                maxLength={255}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="NJU — personal account"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="integration-key">Instance key</Label>
                <Input
                  id="integration-key"
                  required
                  maxLength={64}
                  pattern="[a-z][a-z0-9\-]{0,63}"
                  value={key}
                  disabled={!!initial}
                  onChange={(event) => setKey(event.target.value)}
                  placeholder="nju-personal"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="integration-provider">Provider</Label>
                <Input
                  id="integration-provider"
                  required
                  maxLength={64}
                  pattern="[a-z][a-z0-9\-]{0,63}"
                  value={provider}
                  disabled={!!initial}
                  onChange={(event) => setProvider(event.target.value)}
                  placeholder="nju"
                />
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              Key and provider use lowercase letters, digits and hyphens,
              starting with a letter. Both are fixed after creation.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="integration-timeout">
                  Run timeout (seconds)
                </Label>
                <Input
                  id="integration-timeout"
                  type="number"
                  required
                  min={1}
                  max={2147483647}
                  step={1}
                  value={timeoutSeconds}
                  onChange={(event) => setTimeoutSeconds(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="integration-stale">
                  Report overdue after (seconds)
                </Label>
                <Input
                  id="integration-stale"
                  type="number"
                  required
                  min={1}
                  max={2147483647}
                  step={1}
                  value={staleSeconds}
                  onChange={(event) => setStaleSeconds(event.target.value)}
                />
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              Defaults: 30 minutes per run and 26 hours between completed
              reports.
            </p>
            <div className="flex items-center gap-2">
              <Checkbox
                id="integration-enabled"
                checked={enabled}
                onCheckedChange={(value) => setEnabled(value === true)}
              />
              <Label htmlFor="integration-enabled">Enabled</Label>
            </div>
            <p className="text-sm text-muted-foreground">
              Disabling blocks new run reports and pauses overdue warnings. It
              does not stop a running container or revoke its API key.
            </p>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">
                Associated categories
              </legend>
              {categories.isPending ? (
                <p className="text-sm">Loading categories…</p>
              ) : categories.isError ? (
                <div
                  role="alert"
                  className="space-y-2 text-sm text-destructive"
                >
                  <p>Could not load categories. Retry before saving.</p>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void categories.refetch()}
                  >
                    Retry categories
                  </Button>
                </div>
              ) : (
                <div className="max-h-48 space-y-2 overflow-y-auto rounded-md border p-3">
                  {categories.data?.data.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      No categories in this ledger.
                    </p>
                  )}
                  {categories.data?.data.map((category) => (
                    <div className="flex items-start gap-2" key={category.id}>
                      <Checkbox
                        id={`integration-category-${category.id}`}
                        checked={categoryIds.includes(category.id)}
                        disabled={
                          !categoryIds.includes(category.id) &&
                          categoryIds.length >= 100
                        }
                        onCheckedChange={(checked) =>
                          setCategoryIds((previous) =>
                            checked === true
                              ? [...previous, category.id]
                              : previous.filter((id) => id !== category.id),
                          )
                        }
                      />
                      <Label
                        className="min-w-0 break-words"
                        htmlFor={`integration-category-${category.id}`}
                      >
                        {category.name} ({category.code})
                        {category.archived_at ? " · archived" : ""}
                      </Label>
                    </div>
                  ))}
                </div>
              )}
            </fieldset>
          </fieldset>
          {error && (
            <Alert variant="destructive">
              <AlertTitle>
                {conflict ? "Configuration changed" : "Could not save"}
              </AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={save.isPending}
              onClick={onClose}
            >
              {conflict ? "Close and review" : "Cancel"}
            </Button>
            <LoadingButton
              type="submit"
              loading={save.isPending}
              disabled={conflict || !categories.isSuccess}
            >
              {initial ? "Save changes" : "Create integration"}
            </LoadingButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
