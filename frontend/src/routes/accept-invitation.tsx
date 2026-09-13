import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQuery } from "@tanstack/react-query"
import { createFileRoute, Link as RouterLink } from "@tanstack/react-router"
import type { AxiosError } from "axios"
import { CircleCheckBig, CircleX, LoaderCircle } from "lucide-react"
import { useState } from "react"
import { useForm } from "react-hook-form"
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

const searchSchema = z.object({
  token: z.string().catch(""),
})

const formSchema = z
  .object({
    new_password: z
      .string()
      .min(1, { message: "Password is required" })
      .min(8, { message: "Password must be at least 8 characters" }),
    confirm_password: z
      .string()
      .min(1, { message: "Password confirmation is required" }),
  })
  .refine((data) => data.new_password === data.confirm_password, {
    message: "The passwords don't match",
    path: ["confirm_password"],
  })

type FormData = z.infer<typeof formSchema>

const invitationErrorMessage = (error: Error | null, hasToken: boolean) => {
  if (!hasToken) return "This invitation link is missing its token."

  const detail = (
    (error as AxiosError | null)?.response?.data as
      | { detail?: string }
      | undefined
  )?.detail

  if (detail === "Invitation has expired") {
    return "This invitation has expired. Ask an administrator to resend it."
  }
  if (detail === "Invitation has been revoked") {
    return "This invitation has been revoked. Ask an administrator for a new one."
  }
  if (detail === "Invitation has already been accepted") {
    return "This invitation has already been used. You can sign in to your account."
  }
  if (detail === "Invitation not found") {
    return "This invitation link is invalid."
  }
  return "We could not verify this invitation. Please try again or ask an administrator for a new link."
}

export const Route = createFileRoute("/accept-invitation")({
  component: AcceptInvitation,
  validateSearch: searchSchema,
  head: () => ({
    meta: [{ title: "Accept Invitation - Oblidog" }],
  }),
})

function TerminalState({ message }: { message: string }) {
  return (
    <div className="flex flex-col gap-6 text-center">
      <CircleX className="mx-auto size-10 text-destructive" />
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Invitation unavailable</h1>
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
      <Button asChild>
        <RouterLink to="/login">Go to login</RouterLink>
      </Button>
    </div>
  )
}

function AcceptInvitation() {
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
          Verifying invitation…
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
            <h1 className="text-2xl font-bold">Account created</h1>
            <p className="text-sm text-muted-foreground">
              Your password is set. You can now sign in to Oblidog.
            </p>
          </div>
          <Button asChild>
            <RouterLink to="/login">Go to login</RouterLink>
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
            <h1 className="text-2xl font-bold">Create your account</h1>
            <p className="text-sm text-muted-foreground">
              Set a password to accept your invitation.
            </p>
          </div>

          <div className="grid gap-4">
            <div className="grid gap-2">
              <FormLabel htmlFor="invited-email">Email</FormLabel>
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
                  <FormLabel>Password</FormLabel>
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
                  <FormLabel>Confirm Password</FormLabel>
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
                <AlertTitle>Could not create account</AlertTitle>
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
              Create account
            </LoadingButton>
          </div>
        </form>
      </Form>
    </AuthLayout>
  )
}
