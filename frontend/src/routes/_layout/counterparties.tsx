import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, redirect } from "@tanstack/react-router"
import { ExternalLink, Pencil, Plus, Trash2 } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
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
import {
  type Counterparty,
  type CounterpartyInput,
  createCounterparty,
  deleteCounterparty,
  listCounterparties,
  updateCounterparty,
} from "@/features/counterparties/api"
import { CounterpartyLogo } from "@/features/counterparties/CounterpartyLogo"
import useCustomToast from "@/hooks/useCustomToast"
import { i18n } from "@/i18n"
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
    meta: [{ title: i18n.t("app:counterparties.counterparties_oblidog") }],
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
  useTranslation()

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
      if (!input.name)
        throw new Error(i18n.t("app:counterparties.name_is_required"))
      return counterparty
        ? updateCounterparty(counterparty.id, input)
        : createCounterparty(input)
    },
    onSuccess: () => {
      showSuccessToast(
        editing
          ? i18n.t("app:counterparties.counterparty_updated")
          : i18n.t("app:counterparties.counterparty_created"),
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
            aria-label={i18n.t("app:counterparties.edit", {
              value1: counterparty!.name,
            })}
          >
            <Pencil className="size-4" />
          </Button>
        ) : (
          <Button>
            <Plus className="mr-2 size-4" />
            {i18n.t("app:counterparties.add_counterparty")}
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
              {editing
                ? i18n.t("app:counterparties.edit_counterparty")
                : i18n.t("app:counterparties.add_counterparty")}
            </DialogTitle>
            <DialogDescription>
              {i18n.t(
                "app:counterparties.counterparties_are_shared_across_the_whole_oblidog_installation",
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center gap-3 rounded-lg border p-3">
            <CounterpartyLogo counterparty={preview} className="size-12" />
            <div className="min-w-0">
              <p className="truncate font-medium">
                {form.shortName ||
                  form.name ||
                  i18n.t("app:counterparties.preview")}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {form.websiteUrl || i18n.t("app:counterparties.no_website")}
              </p>
            </div>
          </div>

          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor={`counterparty-name-${counterparty?.id ?? "new"}`}>
                {i18n.t("app:counterparties.name")}
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
                {i18n.t("app:counterparties.short_name")}
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
                {i18n.t("app:counterparties.logo_url")}
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
                title={i18n.t(
                  "app:counterparties.enter_a_full_http_or_https_url_for_example_https_example_com",
                )}
                maxLength={2048}
              />
            </div>
            <div className="grid gap-2">
              <Label
                htmlFor={`counterparty-website-url-${counterparty?.id ?? "new"}`}
              >
                {i18n.t("app:counterparties.website_url")}
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
                title={i18n.t(
                  "app:counterparties.enter_a_full_http_or_https_url_for_example_https_example_com",
                )}
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
                {i18n.t("app:counterparties.cancel")}
              </Button>
            </DialogClose>
            <LoadingButton
              loading={mutation.isPending}
              disabled={!form.name.trim()}
              type="submit"
            >
              {editing
                ? i18n.t("app:counterparties.save_changes")
                : i18n.t("app:counterparties.create_counterparty")}
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
  useTranslation()

  const [open, setOpen] = useState(false)
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const mutation = useMutation({
    mutationFn: () => deleteCounterparty(counterparty.id),
    onSuccess: () => {
      showSuccessToast(i18n.t("app:counterparties.counterparty_deleted"))
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
          aria-label={i18n.t("app:counterparties.delete", {
            value1: counterparty.name,
          })}
        >
          <Trash2 className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {i18n.t("app:counterparties.delete_counterparty")}
          </DialogTitle>
          <DialogDescription>
            {i18n.t("app:counterparties.delete_f6fdbe")} {counterparty.name}{" "}
            {i18n.t(
              "app:counterparties.from_the_global_catalog_counterparties_assigned_to_categories_or_obligations_cannot_b",
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={mutation.isPending}>
              {i18n.t("app:counterparties.cancel")}
            </Button>
          </DialogClose>
          <LoadingButton
            variant="destructive"
            loading={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {i18n.t("app:counterparties.delete_f6fdbe")}
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function CounterpartiesAdmin() {
  useTranslation()

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
          <h1 className="text-2xl font-bold tracking-tight">
            {i18n.t("app:counterparties.counterparties")}
          </h1>
          <p className="text-muted-foreground">
            {i18n.t(
              "app:counterparties.manage_the_global_catalog_used_by_categories_and_obligations",
            )}
          </p>
        </div>
        <CounterpartyFormDialog />
      </div>

      <Input
        aria-label={i18n.t("app:counterparties.search_counterparties")}
        placeholder={i18n.t(
          "app:counterparties.search_by_name_short_name_or_website",
        )}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        className="max-w-md"
      />

      {counterparties.isLoading ? (
        <p className="text-sm text-muted-foreground">
          {i18n.t("app:counterparties.loading_counterparties")}
        </p>
      ) : null}
      {counterparties.isError ? (
        <div className="flex items-center gap-3 text-sm text-destructive">
          <span>
            {i18n.t("app:counterparties.unable_to_load_counterparties")}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void counterparties.refetch()}
          >
            {i18n.t("app:counterparties.try_again")}
          </Button>
        </div>
      ) : null}
      {!counterparties.isLoading &&
      !counterparties.isError &&
      filtered.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          {query
            ? i18n.t("app:counterparties.no_counterparties_match_your_search")
            : i18n.t("app:counterparties.no_counterparties_yet")}
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
                <p className="mt-1 text-sm text-muted-foreground">
                  {i18n.t("app:counterparties.no_website")}
                </p>
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
