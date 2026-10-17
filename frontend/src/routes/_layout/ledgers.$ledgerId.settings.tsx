import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { Archive, ArrowLeft, BookOpen, Trash2 } from "lucide-react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { LedgersService } from "@/client"
import { DemoRestrictedSection } from "@/components/Common/DemoRestrictedSection"
import { LedgerPreferences } from "@/components/LedgerSettings/LedgerPreferences"
import LedgerSharing from "@/components/LedgerSettings/LedgerSharing"
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import useCustomToast from "@/hooks/useCustomToast"
import { i18n } from "@/i18n"
import { handleError } from "@/utils"

export const Route = createFileRoute("/_layout/ledgers/$ledgerId/settings")({
  component: LedgerSettings,
  head: () => ({
    meta: [{ title: i18n.t("app:ledgers.ledger_settings_oblidog") }],
  }),
})

function LedgerSettings() {
  useTranslation()

  const { ledgerId } = Route.useParams()
  const { data: ledger } = useSuspenseQuery({
    queryFn: () => LedgersService.readLedger({ ledgerId }),
    queryKey: ["ledger", ledgerId],
  })
  const [name, setName] = useState(ledger.name)
  const [description, setDescription] = useState(ledger.description ?? "")
  const queryClient = useQueryClient()
  const { showErrorToast, showSuccessToast } = useCustomToast()
  const updateMutation = useMutation({
    mutationFn: () =>
      LedgersService.updateLedger({
        ledgerId,
        requestBody: { name, description: description || null },
      }),
    onSuccess: (updatedLedger) => {
      showSuccessToast(i18n.t("app:ledgers.ledger_details_updated"))
      setName(updatedLedger.name)
      setDescription(updatedLedger.description ?? "")
      queryClient.setQueryData(["ledger", ledgerId], updatedLedger)
      void queryClient.invalidateQueries({ queryKey: ["ledgers"] })
    },
    onError: handleError.bind(showErrorToast),
  })
  const [confirmationName, setConfirmationName] = useState("")
  const [dangerOpen, setDangerOpen] = useState(false)
  const [obligationsConfirmationName, setObligationsConfirmationName] =
    useState("")
  const [obligationsDangerOpen, setObligationsDangerOpen] = useState(false)
  const deleteCategoriesMutation = useMutation({
    mutationFn: () => LedgersService.deleteAllCategories({ ledgerId }),
    onSuccess: () => {
      showSuccessToast(i18n.t("app:ledgers.all_ledger_categories_deleted"))
      setConfirmationName("")
      setDangerOpen(false)
      void queryClient.invalidateQueries({
        queryKey: ["category-groups", ledgerId],
      })
      void queryClient.invalidateQueries({ queryKey: ["categories", ledgerId] })
    },
    onError: handleError.bind(showErrorToast),
  })
  const deleteObligationsMutation = useMutation({
    mutationFn: () => LedgersService.deleteAllObligations({ ledgerId }),
    onSuccess: () => {
      showSuccessToast(i18n.t("app:ledgers.all_ledger_obligations_deleted"))
      setObligationsConfirmationName("")
      setObligationsDangerOpen(false)
      void queryClient.invalidateQueries({
        queryKey: ["obligations", ledgerId],
      })
    },
    onError: handleError.bind(showErrorToast),
  })
  const [includeArchived, setIncludeArchived] = useState(() => {
    if (typeof window === "undefined") return false
    return (
      window.localStorage.getItem(`show-archived-categories:${ledgerId}`) ===
      "true"
    )
  })

  useEffect(() => {
    window.localStorage.setItem(
      `show-archived-categories:${ledgerId}`,
      String(includeArchived),
    )
  }, [includeArchived, ledgerId])

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <Button variant="ghost" size="sm" className="w-fit" asChild>
          <Link to="/ledgers/$ledgerId" params={{ ledgerId }}>
            <ArrowLeft />
            {i18n.t("app:ledgers.back_to_workspace")}
          </Link>
        </Button>
        <div>
          <div className="mb-2 flex items-center gap-2">
            <BookOpen className="size-5 text-primary" />
            <Badge variant="outline">
              {i18n.t("app:ledgers.ledger_settings")}
            </Badge>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">{ledger.name}</h1>
          <p className="mt-1 text-muted-foreground">
            {i18n.t("app:ledgers.configure_how_this_ledger_workspace_behaves")}
          </p>
        </div>
      </div>

      <DemoRestrictedSection>
        <Card>
          <CardHeader>
            <CardTitle>{i18n.t("app:ledgers.ledger_details")}</CardTitle>
            <CardDescription>
              {i18n.t(
                "app:ledgers.update_the_name_and_description_shown_throughout_the_workspace",
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Label htmlFor="ledger-name">{i18n.t("app:ledgers.name")}</Label>
              <Input
                id="ledger-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={255}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ledger-description">
                {i18n.t("app:ledgers.description")}
              </Label>
              <textarea
                id="ledger-description"
                className="border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:bg-input/30 flex min-h-24 w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-[3px]"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
            <Button
              disabled={!name.trim() || updateMutation.isPending}
              onClick={() => updateMutation.mutate()}
            >
              {i18n.t("app:ledgers.save_details")}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Archive className="size-5" />
              {i18n.t("app:ledgers.category_visibility")}
            </CardTitle>
            <CardDescription>
              {i18n.t(
                "app:ledgers.choose_whether_archived_groups_and_categories_should_be_shown_in_the_workspace",
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2">
              <Checkbox
                id="show-archived-categories"
                checked={includeArchived}
                onCheckedChange={(checked) =>
                  setIncludeArchived(checked === true)
                }
              />
              <Label htmlFor="show-archived-categories">
                {i18n.t("app:ledgers.show_archived")}
              </Label>
            </div>
          </CardContent>
        </Card>
        <LedgerPreferences key={ledgerId} ledger={ledger} />
        <LedgerSharing ledgerId={ledgerId} />

        <Card className="border-destructive/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="size-5" />
              {i18n.t("app:ledgers.danger_area")}
            </CardTitle>
            <CardDescription>
              {i18n.t(
                "app:ledgers.these_actions_are_permanent_and_cannot_be_undone",
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col justify-between gap-4 rounded-lg border border-destructive/30 p-4 sm:flex-row sm:items-center">
              <div>
                <p className="font-medium">
                  {i18n.t("app:ledgers.delete_all_categories")}
                </p>
                <p className="text-sm text-muted-foreground">
                  {i18n.t(
                    "app:ledgers.permanently_delete_every_category_group_and_category_in_this_ledger",
                  )}
                </p>
              </div>
              <Dialog open={dangerOpen} onOpenChange={setDangerOpen}>
                <DialogTrigger asChild>
                  <Button variant="destructive">
                    {i18n.t("app:ledgers.delete_all_categories")}
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>
                      {i18n.t("app:ledgers.delete_all_categories_d1a5c3")}
                    </DialogTitle>
                    <DialogDescription>
                      {i18n.t(
                        "app:ledgers.this_permanently_deletes_all_category_groups_and_categories_in",
                      )}{" "}
                      <strong>{ledger.name}</strong>
                      {i18n.t("app:ledgers.enter_the_ledger_name_to_confirm")}
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-2 py-2">
                    <Label htmlFor="delete-categories-confirmation">
                      {i18n.t("app:ledgers.ledger_name")}
                    </Label>
                    <Input
                      id="delete-categories-confirmation"
                      value={confirmationName}
                      onChange={(event) =>
                        setConfirmationName(event.target.value)
                      }
                    />
                  </div>
                  <DialogFooter>
                    <DialogClose asChild>
                      <Button
                        variant="outline"
                        disabled={deleteCategoriesMutation.isPending}
                      >
                        {i18n.t("app:ledgers.cancel")}
                      </Button>
                    </DialogClose>
                    <Button
                      variant="destructive"
                      disabled={
                        confirmationName !== ledger.name ||
                        deleteCategoriesMutation.isPending
                      }
                      onClick={() => deleteCategoriesMutation.mutate()}
                    >
                      {i18n.t("app:ledgers.delete_permanently")}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
            <div className="flex flex-col justify-between gap-4 rounded-lg border border-destructive/30 p-4 sm:flex-row sm:items-center">
              <div>
                <p className="font-medium">
                  {i18n.t("app:ledgers.delete_all_obligations")}
                </p>
                <p className="text-sm text-muted-foreground">
                  {i18n.t(
                    "app:ledgers.permanently_delete_every_obligation_in_this_ledger",
                  )}
                </p>
              </div>
              <Dialog
                open={obligationsDangerOpen}
                onOpenChange={setObligationsDangerOpen}
              >
                <DialogTrigger asChild>
                  <Button variant="destructive">
                    {i18n.t("app:ledgers.delete_all_obligations")}
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>
                      {i18n.t("app:ledgers.delete_all_obligations_660067")}
                    </DialogTitle>
                    <DialogDescription>
                      {i18n.t(
                        "app:ledgers.this_permanently_deletes_every_obligation_in",
                      )}{" "}
                      <strong>{ledger.name}</strong>
                      {i18n.t("app:ledgers.enter_the_ledger_name_to_confirm")}
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-2 py-2">
                    <Label htmlFor="delete-obligations-confirmation">
                      {i18n.t("app:ledgers.ledger_name")}
                    </Label>
                    <Input
                      id="delete-obligations-confirmation"
                      value={obligationsConfirmationName}
                      onChange={(event) =>
                        setObligationsConfirmationName(event.target.value)
                      }
                    />
                  </div>
                  <DialogFooter>
                    <DialogClose asChild>
                      <Button
                        variant="outline"
                        disabled={deleteObligationsMutation.isPending}
                      >
                        {i18n.t("app:ledgers.cancel")}
                      </Button>
                    </DialogClose>
                    <Button
                      variant="destructive"
                      disabled={
                        obligationsConfirmationName !== ledger.name ||
                        deleteObligationsMutation.isPending
                      }
                      onClick={() => deleteObligationsMutation.mutate()}
                    >
                      {i18n.t("app:ledgers.delete_permanently")}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </CardContent>
        </Card>
      </DemoRestrictedSection>
    </div>
  )
}
