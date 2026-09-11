import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { Archive, ArrowLeft, BookOpen, Trash2 } from "lucide-react"
import { useEffect, useState } from "react"

import { LedgersService } from "@/client"
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
import { handleError } from "@/utils"

export const Route = createFileRoute("/_layout/ledgers/$ledgerId/settings")({
  component: LedgerSettings,
  head: () => ({ meta: [{ title: "Ledger Settings - Oblidog" }] }),
})

function LedgerSettings() {
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
      showSuccessToast("Ledger details updated")
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
      showSuccessToast("All ledger categories deleted")
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
      showSuccessToast("All ledger obligations deleted")
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
            Back to workspace
          </Link>
        </Button>
        <div>
          <div className="mb-2 flex items-center gap-2">
            <BookOpen className="size-5 text-primary" />
            <Badge variant="outline">Ledger settings</Badge>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">{ledger.name}</h1>
          <p className="mt-1 text-muted-foreground">
            Configure how this ledger workspace behaves.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Ledger details</CardTitle>
          <CardDescription>
            Update the name and description shown throughout the workspace.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Label htmlFor="ledger-name">Name</Label>
            <Input
              id="ledger-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={255}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ledger-description">Description</Label>
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
            Save details
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Archive className="size-5" />
            Category visibility
          </CardTitle>
          <CardDescription>
            Choose whether archived groups and categories should be shown in the
            workspace.
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
            <Label htmlFor="show-archived-categories">Show archived</Label>
          </div>
        </CardContent>
      </Card>
      <LedgerSharing ledgerId={ledgerId} />

      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <Trash2 className="size-5" />
            Danger area
          </CardTitle>
          <CardDescription>
            These actions are permanent and cannot be undone.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col justify-between gap-4 rounded-lg border border-destructive/30 p-4 sm:flex-row sm:items-center">
            <div>
              <p className="font-medium">Delete all categories</p>
              <p className="text-sm text-muted-foreground">
                Permanently delete every category group and category in this
                ledger.
              </p>
            </div>
            <Dialog open={dangerOpen} onOpenChange={setDangerOpen}>
              <DialogTrigger asChild>
                <Button variant="destructive">Delete all categories</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Delete all categories?</DialogTitle>
                  <DialogDescription>
                    This permanently deletes all category groups and categories
                    in <strong>{ledger.name}</strong>. Enter the ledger name to
                    confirm.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-2 py-2">
                  <Label htmlFor="delete-categories-confirmation">
                    Ledger name
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
                      Cancel
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
                    Delete permanently
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
          <div className="flex flex-col justify-between gap-4 rounded-lg border border-destructive/30 p-4 sm:flex-row sm:items-center">
            <div>
              <p className="font-medium">Delete all obligations</p>
              <p className="text-sm text-muted-foreground">
                Permanently delete every obligation in this ledger.
              </p>
            </div>
            <Dialog
              open={obligationsDangerOpen}
              onOpenChange={setObligationsDangerOpen}
            >
              <DialogTrigger asChild>
                <Button variant="destructive">Delete all obligations</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Delete all obligations?</DialogTitle>
                  <DialogDescription>
                    This permanently deletes every obligation in{" "}
                    <strong>{ledger.name}</strong>. Enter the ledger name to
                    confirm.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-2 py-2">
                  <Label htmlFor="delete-obligations-confirmation">
                    Ledger name
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
                      Cancel
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
                    Delete permanently
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
