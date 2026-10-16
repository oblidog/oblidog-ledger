import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { useTranslation } from "react-i18next"
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
import { i18n, type resources } from "@/i18n"

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
  useTranslation()

  const queryClient = useQueryClient()
  const [name, setName] = useState(initial?.name ?? "")
  const [categoryId, setCategoryId] = useState(initial?.category_id ?? "")
  const [error, setError] = useState<
    keyof typeof resources.en.app.integrations | null
  >(null)
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
    onError: () => setError("could_not_save_the_integration_please_try_again"),
  })
  return (
    <Dialog open onOpenChange={(open) => !open && !save.isPending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {initial
              ? i18n.t("app:integrations.configure_integration")
              : i18n.t("app:integrations.add_integration")}
          </DialogTitle>
          <DialogDescription>
            {initial
              ? i18n.t("app:integrations.change_the_integration_name")
              : i18n.t(
                  "app:integrations.choose_a_name_and_exactly_one_category_a_connection_key_is_created_automatically",
                )}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (!name.trim() || (!initial && !categoryId)) {
              setError("enter_a_name_and_select_a_category")
              return
            }
            setError(null)
            save.mutate()
          }}
        >
          <fieldset className="space-y-4" disabled={save.isPending}>
            <div className="space-y-2">
              <Label htmlFor="integration-name">
                {i18n.t("app:integrations.name")}
              </Label>
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
                <Label htmlFor="integration-category">
                  {i18n.t("app:integrations.category")}
                </Label>
                <select
                  id="integration-category"
                  className="border-input h-9 w-full rounded-md border bg-transparent px-3 text-sm"
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  required
                >
                  <option value="">
                    {i18n.t("app:integrations.select_a_category")}
                  </option>
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
              <AlertTitle>
                {i18n.t("app:integrations.could_not_save")}
              </AlertTitle>
              <AlertDescription>
                {i18n.t(`app:integrations.${error}`)}
              </AlertDescription>
            </Alert>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {i18n.t("app:integrations.cancel")}
            </Button>
            <LoadingButton
              type="submit"
              loading={save.isPending}
              disabled={!categories.isSuccess}
            >
              {initial
                ? i18n.t("app:integrations.save_changes")
                : i18n.t("app:integrations.create_integration")}
            </LoadingButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
