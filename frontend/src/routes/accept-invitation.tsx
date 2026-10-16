import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQuery } from "@tanstack/react-query"
import { createFileRoute, Link as RouterLink } from "@tanstack/react-router"
import type { AxiosError } from "axios"
import { CircleCheckBig, CircleX, LoaderCircle } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { z } from "zod"
import { UserInvitationsService } from "@/client"
import { AuthLayout } from "@/components/Common/AuthLayout"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
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
import { PasswordInput } from "@/components/ui/password-input"
import { i18n } from "@/i18n"
import { useLocalizedForm as useForm } from "@/i18n/useLocalizedForm"

const searchSchema = z.object({
  token: z.string().catch(""),
})

const formSchema = z
  .object({
    new_password: z
      .string()
      .min(1, { error: () => i18n.t("app:auth.password_is_required") })
      .min(8, {
        error: () => i18n.t("app:auth.password_must_be_at_least_8_characters"),
      }),
    confirm_password: z.string().min(1, {
      error: () => i18n.t("app:auth.password_confirmation_is_required"),
    }),
  })
  .refine((data) => data.new_password === data.confirm_password, {
    error: () => i18n.t("app:auth.the_passwords_don_t_match"),
    path: ["confirm_password"],
  })

type FormData = z.infer<typeof formSchema>

const invitationErrorMessage = (error: Error | null, hasToken: boolean) => {
  if (!hasToken)
    return i18n.t("app:auth.this_invitation_link_is_missing_its_token")

  const detail = (
    (error as AxiosError | null)?.response?.data as
      | { detail?: string }
      | undefined
  )?.detail

  if (detail === "Invitation has expired") {
    return i18n.t(
      "app:auth.this_invitation_has_expired_ask_an_administrator_to_resend_it",
    )
  }
  if (detail === "Invitation has been revoked") {
    return i18n.t(
      "app:auth.this_invitation_has_been_revoked_ask_an_administrator_for_a_new_one_message",
    )
  }
  if (detail === "Invitation has already been accepted") {
    return i18n.t(
      "app:auth.this_invitation_has_already_been_used_you_can_sign_in_to_your_account",
    )
  }
  if (detail === "Invitation not found") {
    return i18n.t("app:auth.this_invitation_link_is_invalid")
  }
  return i18n.t(
    "app:auth.we_could_not_verify_this_invitation_please_try_again_or_ask_an_administrator_for_a_ne",
  )
}

export const Route = createFileRoute("/accept-invitation")({
  component: AcceptInvitation,
  validateSearch: searchSchema,
  head: () => ({
    meta: [{ title: i18n.t("app:auth.accept_invitation_oblidog") }],
  }),
})

function TerminalState({ message }: { message: string }) {
  useTranslation()

  return (
    <div className="flex flex-col gap-6 text-center">
      <CircleX className="mx-auto size-10 text-destructive" />
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">
          {i18n.t("app:auth.invitation_unavailable")}
        </h1>
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
      <Button asChild>
        <RouterLink to="/login">{i18n.t("app:auth.go_to_login")}</RouterLink>
      </Button>
    </div>
  )
}

function AcceptInvitation() {
  useTranslation()

  const { token } = Route.useSearch()
  const [accepted, setAccepted] = useState(false)
  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    mode: "onBlur",
    criteriaMode: "all",
    defaultValues: { new_password: "", confirm_password: "" },
  })

  const invitationQuery = useQuery({
    queryKey: ["invitation", token],
    queryFn: () => UserInvitationsService.inspectInvitation({ token }),
    enabled: Boolean(token),
    retry: false,
  })

  const acceptMutation = useMutation({
    mutationFn: (data: FormData) =>
      UserInvitationsService.acceptInvitation({
        token,
        requestBody: { new_password: data.new_password },
      }),
    onSuccess: () => {
      form.reset()
      setAccepted(true)
    },
  })

  if (!token || invitationQuery.isError) {
    return (
      <AuthLayout>
        <TerminalState
          message={invitationErrorMessage(
            invitationQuery.error,
            Boolean(token),
          )}
        />
      </AuthLayout>
    )
  }

  if (invitationQuery.isPending) {
    return (
      <AuthLayout>
        <div className="flex items-center justify-center gap-3 text-muted-foreground">
          <LoaderCircle className="size-5 animate-spin" />
          {i18n.t("app:auth.verifying_invitation")}
        </div>
      </AuthLayout>
    )
  }

  if (accepted) {
    return (
      <AuthLayout>
        <div className="flex flex-col gap-6 text-center">
          <CircleCheckBig className="mx-auto size-10 text-green-600" />
          <div className="space-y-2">
            <h1 className="text-2xl font-bold">
              {i18n.t("app:auth.account_created")}
            </h1>
            <p className="text-sm text-muted-foreground">
              {i18n.t(
                "app:auth.your_password_is_set_you_can_now_sign_in_to_oblidog",
              )}
            </p>
          </div>
          <Button asChild>
            <RouterLink to="/login">
              {i18n.t("app:auth.go_to_login")}
            </RouterLink>
          </Button>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout>
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit((data) => acceptMutation.mutate(data))}
          className="flex flex-col gap-6"
        >
          <div className="flex flex-col items-center gap-2 text-center">
            <h1 className="text-2xl font-bold">
              {i18n.t("app:auth.create_your_account")}
            </h1>
            <p className="text-sm text-muted-foreground">
              {i18n.t("app:auth.set_a_password_to_accept_your_invitation")}
            </p>
          </div>

          <div className="grid gap-4">
            <div className="grid gap-2">
              <FormLabel htmlFor="invited-email">
                {i18n.t("app:auth.email")}
              </FormLabel>
              <Input
                id="invited-email"
                data-testid="invited-email"
                value={invitationQuery.data.email}
                readOnly
                aria-readonly="true"
              />
            </div>

            <FormField
              control={form.control}
              name="new_password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{i18n.t("app:auth.password")}</FormLabel>
                  <FormControl>
                    <PasswordInput
                      data-testid="new-password-input"
                      autoComplete="new-password"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="confirm_password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{i18n.t("app:auth.confirm_password")}</FormLabel>
                  <FormControl>
                    <PasswordInput
                      data-testid="confirm-password-input"
                      autoComplete="new-password"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {acceptMutation.isError && (
              <Alert variant="destructive">
                <CircleX />
                <AlertTitle>
                  {i18n.t("app:auth.could_not_create_account")}
                </AlertTitle>
                <AlertDescription>
                  {invitationErrorMessage(acceptMutation.error, true)}
                </AlertDescription>
              </Alert>
            )}

            <LoadingButton
              type="submit"
              className="w-full"
              loading={acceptMutation.isPending}
            >
              {i18n.t("app:auth.create_account")}
            </LoadingButton>
          </div>
        </form>
      </Form>
    </AuthLayout>
  )
}
