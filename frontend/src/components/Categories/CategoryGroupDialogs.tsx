import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Archive, FolderPlus, Pencil, Settings2 } from "lucide-react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  CategoriesService,
  type CategoryGroupCreate,
  type CategoryGroupUpdate,
  type CategoryPublic,
} from "@/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { LoadingButton } from "@/components/ui/loading-button"
import useCustomToast from "@/hooks/useCustomToast"
import { i18n } from "@/i18n"
import { useLocalizedForm as useForm } from "@/i18n/useLocalizedForm"
import { handleError } from "@/utils"
import { type GroupFormData, groupSchema } from "./categoryForms"
import { categoryQueryKeys } from "./categoryQueryKeys"

export function CreateGroupDialog({ ledgerId }: { ledgerId: string }) {
  useTranslation()

  const [open, setOpen] = useState(false)
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const form = useForm<GroupFormData>({
    resolver: zodResolver(groupSchema),
    defaultValues: { name: "", description: "" },
  })
  const mutation = useMutation({
    mutationFn: (data: CategoryGroupCreate) =>
      CategoriesService.createCategoryGroup({ ledgerId, requestBody: data }),
    onSuccess: () => {
      showSuccessToast(i18n.t("app:categories.category_group_created"))
      form.reset()
      setOpen(false)
    },
    onError: handleError.bind(showErrorToast),
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: categoryQueryKeys.groups(ledgerId),
      }),
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <FolderPlus />
          {i18n.t("app:categories.new_group")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {i18n.t("app:categories.create_category_group")}
          </DialogTitle>
          <DialogDescription>
            {i18n.t("app:categories.groups_keep_related_categories_together")}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((data) =>
              mutation.mutate({
                ...data,
                description: data.description || null,
              }),
            )}
            className="space-y-4"
          >
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{i18n.t("app:categories.name")}</FormLabel>
                  <FormControl>
                    <Input
                      placeholder={i18n.t("app:categories.utilities")}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{i18n.t("app:categories.description")}</FormLabel>
                  <FormControl>
                    <Input
                      placeholder={i18n.t(
                        "app:categories.optional_description",
                      )}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <LoadingButton type="submit" loading={mutation.isPending}>
                {i18n.t("app:categories.create_group")}
              </LoadingButton>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

function EditGroupDialog({
  ledgerId,
  group,
}: {
  ledgerId: string
  group: { id: string; name: string; description: string | null }
}) {
  useTranslation()

  const [open, setOpen] = useState(false)
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const form = useForm<GroupFormData>({
    resolver: zodResolver(groupSchema),
    defaultValues: { name: group.name, description: group.description ?? "" },
  })

  useEffect(() => {
    if (open)
      form.reset({ name: group.name, description: group.description ?? "" })
  }, [form, group.description, group.name, open])

  const mutation = useMutation({
    mutationFn: (data: CategoryGroupUpdate) =>
      CategoriesService.updateCategoryGroup({
        ledgerId,
        categoryGroupId: group.id,
        requestBody: data,
      }),
    onSuccess: () => {
      showSuccessToast(i18n.t("app:categories.category_group_updated"))
      setOpen(false)
    },
    onError: handleError.bind(showErrorToast),
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: categoryQueryKeys.groups(ledgerId),
      }),
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <Pencil />
          <span className="sr-only">
            {i18n.t("app:categories.edit")} {group.name}
          </span>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {i18n.t("app:categories.edit_category_group")}
          </DialogTitle>
          <DialogDescription>
            {i18n.t(
              "app:categories.update_the_name_or_description_of_this_group",
            )}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((data) =>
              mutation.mutate({
                ...data,
                description: data.description || null,
              }),
            )}
            className="space-y-4"
          >
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{i18n.t("app:categories.name")}</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{i18n.t("app:categories.description")}</FormLabel>
                  <FormControl>
                    <Input
                      placeholder={i18n.t(
                        "app:categories.optional_description",
                      )}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <LoadingButton type="submit" loading={mutation.isPending}>
                {i18n.t("app:categories.save_group_changes")}
              </LoadingButton>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

function ArchiveButton({
  label,
  onArchive,
}: {
  label: string
  onArchive: () => void
}) {
  useTranslation()

  return (
    <Button variant="ghost" size="sm" onClick={onArchive}>
      <Archive />
      <span className="sr-only">
        {i18n.t("app:categories.archive")} {label}
      </span>
    </Button>
  )
}

export function ManageGroupsDialog({
  ledgerId,
  groups,
  categories,
  onArchive,
}: {
  ledgerId: string
  groups: {
    id: string
    name: string
    description: string | null
    is_active: boolean
  }[]
  categories: CategoryPublic[]
  onArchive: (groupId: string) => void
}) {
  useTranslation()

  const [open, setOpen] = useState(false)
  const activeCategoryCount = (groupId: string) =>
    categories.filter(
      (category) =>
        category.category_group_id === groupId && category.is_active,
    ).length

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Settings2 />
          {i18n.t("app:categories.manage_groups")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {i18n.t("app:categories.manage_category_groups")}
          </DialogTitle>
          <DialogDescription>
            {i18n.t(
              "app:categories.categories_always_belong_to_a_group_archive_active_categories_or_move_them_before_arc",
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-end">
          <CreateGroupDialog ledgerId={ledgerId} />
        </div>
        {groups.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {i18n.t("app:categories.no_groups_yet")}
          </p>
        ) : (
          <div className="divide-y rounded-lg border">
            {groups.map((group) => {
              const count = activeCategoryCount(group.id)
              return (
                <div
                  key={group.id}
                  className="flex items-center justify-between gap-3 p-4"
                >
                  <div className="min-w-0">
                    <p
                      className={
                        group.is_active
                          ? "font-medium"
                          : "font-medium text-muted-foreground line-through"
                      }
                    >
                      {group.name}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {i18n.t("app:messages.active_categories", { count })}
                      {group.description ? ` · ${group.description}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <EditGroupDialog ledgerId={ledgerId} group={group} />
                    {!group.is_active ? (
                      <Badge variant="secondary">
                        {i18n.t("app:categories.archived")}
                      </Badge>
                    ) : (
                      <ArchiveButton
                        label={group.name}
                        onArchive={() => onArchive(group.id)}
                      />
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
