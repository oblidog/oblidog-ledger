import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { MailPlus } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { z } from "zod"
import { type UserInvitationCreate, UserInvitationsService } from "@/client"
import { Button } from "@/components/ui/button"
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

const formSchema = z.object({
  email: z.email({ error: () => i18n.t("app:admin.invalid_email_address") }),
  full_name: z.string().optional(),
  is_superuser: z.boolean(),
})

type FormData = z.infer<typeof formSchema>

const InviteUser = () => {
  useTranslation()

  const [isOpen, setIsOpen] = useState(false)
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    mode: "onBlur",
    criteriaMode: "all",
    defaultValues: {
      email: "",
      full_name: "",
      is_superuser: false,
    },
  })

  const mutation = useMutation({
    mutationFn: (data: UserInvitationCreate) =>
      UserInvitationsService.createInvitation({ requestBody: data }),
    onSuccess: () => {
      showSuccessToast(i18n.t("app:admin.invitation_sent"))
      form.reset()
      setIsOpen(false)
    },
    onError: handleError.bind(showErrorToast),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["user-invitations"] })
    },
  })

  const onSubmit = (data: FormData) => {
    mutation.mutate({
      ...data,
      full_name: data.full_name?.trim() || null,
    })
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button>
          <MailPlus />
          {i18n.t("app:admin.invite_user")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{i18n.t("app:admin.invite_user")}</DialogTitle>
          <DialogDescription>
            {i18n.t(
              "app:admin.we_will_email_a_secure_link_so_the_recipient_can_create_their_own_password",
            )}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <div className="grid gap-4 py-4">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {i18n.t("app:admin.email")}{" "}
                      <span className="text-destructive">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder={i18n.t("app:admin.email")}
                        type="email"
                        autoComplete="off"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="full_name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{i18n.t("app:admin.full_name")}</FormLabel>
                    <FormControl>
                      <Input
                        placeholder={i18n.t("app:admin.full_name_eeb692")}
                        type="text"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="is_superuser"
                render={({ field }) => (
                  <FormItem className="flex items-center gap-3 space-y-0">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                    <FormLabel className="font-normal">
                      {i18n.t("app:admin.is_superuser")}
                    </FormLabel>
                  </FormItem>
                )}
              />
            </div>

            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline" disabled={mutation.isPending}>
                  {i18n.t("app:admin.cancel")}
                </Button>
              </DialogClose>
              <LoadingButton type="submit" loading={mutation.isPending}>
                {i18n.t("app:admin.send_invitation")}
              </LoadingButton>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

export default InviteUser
