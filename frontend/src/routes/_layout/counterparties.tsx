import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, redirect } from "@tanstack/react-router"
import { ExternalLink, Pencil, Plus, Trash2 } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { UsersService } from "@/client"
import { Button } from "@/components/ui/button"
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
import { LoadingButton } from "@/components/ui/loading-button"
import { CounterpartyLogo } from "@/features/counterparties/CounterpartyLogo"
import {
  type Counterparty,
  type CounterpartyInput,
  createCounterparty,
  deleteCounterparty,
  listCounterparties,
  updateCounterparty,
} from "@/features/counterparties/api"
import useCustomToast from "@/hooks/useCustomToast"
import { handleError } from "@/utils"

export const Route = createFileRoute("/_layout/counterparties")({
  component: CounterpartiesAdmin,
  beforeLoad: async () => {
    const user = await UsersService.readUserMe()
    if (!user.is_superuser) {
      throw redirect({ to: "/" })
    }
  },
  head: () => ({
    meta: [{ title: "Counterparties - Oblidog" }],
  }),
})

type FormState = {
  name: string
  shortName: string
  logoUrl: string
  websiteUrl: string
}

const emptyForm: FormState = {
  name: "",
  shortName: "",
  logoUrl: "",
  websiteUrl: "",
}

function toInput(form: FormState): CounterpartyInput {
  return {
    name: form.name.trim(),
    short_name: form.shortName.trim() || null,
    logo_url: form.logoUrl.trim() || null,
    website_url: form.websiteUrl.trim() || null,
  }
}

function fromCounterparty(counterparty: Counterparty): FormState {
  return {
    name: counterparty.name,
    shortName: counterparty.short_name ?? "",
    logoUrl: counterparty.logo_url ?? "",
    websiteUrl: counterparty.website_url ?? "",
  }
}

function CounterpartyFormDialog({
  counterparty,
}: {
  counterparty?: Counterparty
}) {
  const editing = Boolean(counterparty)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<FormState>(
    counterparty ? fromCounterparty(counterparty) : emptyForm,
  )
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  useEffect(() => {
    if (!open) return
    setForm(counterparty ? fromCounterparty(counterparty) : emptyForm)
  }, [counterparty, open])

  const mutation = useMutation({
    mutationFn: () => {
      const input = toInput(form)
      if (!input.name) throw new Error("Name is required")
      return counterparty
        ? updateCounterparty(counterparty.id, input)
        : createCounterparty(input)
    },
    onSuccess: () => {
      showSuccessToast(
        editing ? "Counterparty updated" : "Counterparty created",
      )
      setOpen(false)
      void queryClient.invalidateQueries({ queryKey: ["counterparties"] })
    },
    onError: handleError.bind(showErrorToast),
  })

  const preview: Counterparty = {
    id: counterparty?.id ?? "preview",
    name: form.name || "Counterparty",
    short_name: form.shortName || null,
    logo_url: form.logoUrl || null,
    website_url: form.websiteUrl || null,
    created_at: counterparty?.created_at ?? "",
    updated_at: counterparty?.updated_at ?? "",
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {editing ? (
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Edit ${counterparty!.name}`}
          >
            <Pencil className="size-4" />
          </Button>
        ) : (
          <Button>
            <Plus className="mr-2 size-4" />
            Add counterparty
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <form
          className="grid min-w-0 gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (!mutation.isPending) mutation.mutate()
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {editing ? "Edit counterparty" : "Add counterparty"}
            </DialogTitle>
            <DialogDescription>
              Counterparties are shared across the whole Oblidog installation.
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center gap-3 rounded-lg border p-3">
            <CounterpartyLogo counterparty={preview} className="size-12" />
            <div className="min-w-0">
              <p className="truncate font-medium">
                {form.shortName || form.name || "Preview"}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {form.websiteUrl || "No website"}
              </p>
            </div>
          </div>

          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor={`counterparty-name-${counterparty?.id ?? "new"}`}>
                Name *
              </Label>
              <Input
                id={`counterparty-name-${counterparty?.id ?? "new"}`}
                value={form.name}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                placeholder="Enea S.A."
                required
                maxLength={255}
                autoFocus
              />
            </div>
            <div className="grid gap-2">
              <Label
                htmlFor={`counterparty-short-name-${counterparty?.id ?? "new"}`}
              >
                Short name
              </Label>
              <Input
                id={`counterparty-short-name-${counterparty?.id ?? "new"}`}
                value={form.shortName}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    shortName: event.target.value,
                  }))
                }
                placeholder="Enea"
                maxLength={255}
              />
            </div>
            <div className="grid gap-2">
              <Label
                htmlFor={`counterparty-logo-url-${counterparty?.id ?? "new"}`}
              >
                Logo URL
              </Label>
              <Input
                id={`counterparty-logo-url-${counterparty?.id ?? "new"}`}
                value={form.logoUrl}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    logoUrl: event.target.value,
                  }))
                }
                placeholder="https://example.com/logo.svg"
                type="url"
                pattern="https?://.+"
                title="Enter a full HTTP or HTTPS URL, for example https://example.com"
                maxLength={2048}
              />
            </div>
            <div className="grid gap-2">
              <Label
                htmlFor={`counterparty-website-url-${counterparty?.id ?? "new"}`}
              >
                Website URL
              </Label>
              <Input
                id={`counterparty-website-url-${counterparty?.id ?? "new"}`}
                value={form.websiteUrl}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    websiteUrl: event.target.value,
                  }))
                }
                placeholder="https://www.enea.pl"
                type="url"
                pattern="https?://.+"
                title="Enter a full HTTP or HTTPS URL, for example https://example.com"
                maxLength={2048}
              />
            </div>
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button
                type="button"
                variant="outline"
                disabled={mutation.isPending}
              >
                Cancel
              </Button>
            </DialogClose>
            <LoadingButton
              loading={mutation.isPending}
              disabled={!form.name.trim()}
              type="submit"
            >
              {editing ? "Save changes" : "Create counterparty"}
            </LoadingButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function DeleteCounterpartyDialog({
  counterparty,
}: {
  counterparty: Counterparty
}) {
  const [open, setOpen] = useState(false)
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const mutation = useMutation({
    mutationFn: () => deleteCounterparty(counterparty.id),
    onSuccess: () => {
      showSuccessToast("Counterparty deleted")
      setOpen(false)
      void queryClient.invalidateQueries({ queryKey: ["counterparties"] })
    },
    onError: handleError.bind(showErrorToast),
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Delete ${counterparty.name}`}
        >
          <Trash2 className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete counterparty?</DialogTitle>
          <DialogDescription>
            Delete {counterparty.name} from the global catalog. Counterparties
            assigned to categories or obligations cannot be deleted.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={mutation.isPending}>
              Cancel
            </Button>
          </DialogClose>
          <LoadingButton
            variant="destructive"
            loading={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            Delete
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CounterpartiesAdmin() {
  const [query, setQuery] = useState("")
  const counterparties = useQuery({
    queryKey: ["counterparties"],
    queryFn: listCounterparties,
  })

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    const items = counterparties.data?.data ?? []
    if (!normalized) return items
    return items.filter((counterparty) =>
      [counterparty.name, counterparty.short_name, counterparty.website_url]
        .filter(Boolean)
        .some((value) => value!.toLocaleLowerCase().includes(normalized)),
    )
  }, [counterparties.data?.data, query])

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Counterparties</h1>
          <p className="text-muted-foreground">
            Manage the global catalog used by categories and obligations.
          </p>
        </div>
        <CounterpartyFormDialog />
      </div>

      <Input
        aria-label="Search counterparties"
        placeholder="Search by name, short name or website…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        className="max-w-md"
      />

      {counterparties.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading counterparties…</p>
      ) : null}
      {counterparties.isError ? (
        <div className="flex items-center gap-3 text-sm text-destructive">
          <span>Unable to load counterparties.</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void counterparties.refetch()}
          >
            Try again
          </Button>
        </div>
      ) : null}
      {!counterparties.isLoading &&
      !counterparties.isError &&
      filtered.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          {query
            ? "No counterparties match your search."
            : "No counterparties yet."}
        </p>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-2">
        {filtered.map((counterparty) => (
          <div
            key={counterparty.id}
            data-testid={`counterparty-${counterparty.id}`}
            className="flex items-center gap-3 rounded-lg border p-4"
          >
            <CounterpartyLogo counterparty={counterparty} className="size-12" />
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <p className="truncate font-semibold">{counterparty.name}</p>
                {counterparty.short_name ? (
                  <span
                    className="min-w-0 max-w-[50%] truncate rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                    title={counterparty.short_name}
                  >
                    {counterparty.short_name}
                  </span>
                ) : null}
              </div>
              {counterparty.website_url ? (
                <a
                  href={counterparty.website_url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-flex max-w-full items-center gap-1 truncate text-sm text-muted-foreground hover:underline"
                >
                  <span className="truncate">{counterparty.website_url}</span>
                  <ExternalLink className="size-3 shrink-0" />
                </a>
              ) : (
                <p className="mt-1 text-sm text-muted-foreground">No website</p>
              )}
            </div>
            <div className="flex shrink-0 items-center">
              <CounterpartyFormDialog counterparty={counterparty} />
              <DeleteCounterpartyDialog counterparty={counterparty} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
