import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import {
  CategoriesService,
  type IntegrationPublic,
  IntegrationsService,
} from "@/client"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
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

export function IntegrationForm({
  ledgerId,
  initial,
  onClose,
  onSaved,
}: {
  ledgerId: string
  initial?: IntegrationPublic
  onClose: () => void
  onSaved: (item: IntegrationPublic, connectionKey?: string) => void
}) {
  const queryClient = useQueryClient()
  const [name, setName] = useState(initial?.name ?? "")
  const [categoryId, setCategoryId] = useState(initial?.category_id ?? "")
  const [error, setError] = useState<string | null>(null)
  const categories = useQuery({
    queryKey: ["integration-categories", ledgerId],
    queryFn: () =>
      CategoriesService.readCategories({ ledgerId, includeArchived: true }),
  })
  const save = useMutation({
    mutationFn: async () =>
      initial
        ? {
            integration: await IntegrationsService.updateIntegration({
              ledgerId,
              integrationId: initial.id,
              requestBody: {
                expected_revision: initial.revision,
                name: name.trim(),
              },
            }),
          }
        : IntegrationsService.createIntegration({
            ledgerId,
            requestBody: { name: name.trim(), category_id: categoryId },
          }),
    onSuccess: (result) => {
      const item = result.integration
      queryClient.setQueryData(["integration", ledgerId, item.id], item)
      void queryClient.invalidateQueries({
        queryKey: ["integrations", ledgerId],
      })
      onSaved(
        item,
        "connection_key" in result ? result.connection_key : undefined,
      )
    },
    onError: () =>
      setError("Could not save the integration. Please try again."),
  })
  return (
    <Dialog open onOpenChange={(open) => !open && !save.isPending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {initial ? "Configure integration" : "Add integration"}
          </DialogTitle>
          <DialogDescription>
            {initial
              ? "Change the integration name."
              : "Choose a name and exactly one category. A connection key is created automatically."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (!name.trim() || (!initial && !categoryId)) {
              setError("Enter a name and select a category.")
              return
            }
            setError(null)
            save.mutate()
          }}
        >
          <fieldset className="space-y-4" disabled={save.isPending}>
            <div className="space-y-2">
              <Label htmlFor="integration-name">Name</Label>
              <Input
                id="integration-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={255}
                required
              />
            </div>
            {!initial && (
              <div className="space-y-2">
                <Label htmlFor="integration-category">Category</Label>
                <select
                  id="integration-category"
                  className="border-input h-9 w-full rounded-md border bg-transparent px-3 text-sm"
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  required
                >
                  <option value="">Select a category</option>
                  {categories.data?.data.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name} ({category.code})
                    </option>
                  ))}
                </select>
              </div>
            )}
          </fieldset>
          {error && (
            <Alert variant="destructive">
              <AlertTitle>Could not save</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <LoadingButton
              type="submit"
              loading={save.isPending}
              disabled={!categories.isSuccess}
            >
              {initial ? "Save changes" : "Create integration"}
            </LoadingButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
