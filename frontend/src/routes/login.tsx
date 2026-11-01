import { zodResolver } from "@hookform/resolvers/zod"
import {
  createFileRoute,
  Link as RouterLink,
  redirect,
} from "@tanstack/react-router"
import { Info } from "lucide-react"
import { useEffect } from "react"
import { useTranslation } from "react-i18next"
import { z } from "zod"
import type { Body_login_login_access_token as AccessToken } from "@/client"
import { AuthLayout } from "@/components/Common/AuthLayout"
import { DemoBanner } from "@/components/Common/DemoBanner"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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
import useAuth, { isLoggedIn } from "@/hooks/useAuth"
import { usePublicAppConfig } from "@/hooks/usePublicAppConfig"
import { i18n } from "@/i18n"
import { useLocalizedForm as useForm } from "@/i18n/useLocalizedForm"

const formSchema = z.object({
  username: z.email(),
  password: z
    .string()
    .min(1, { error: () => i18n.t("app:auth.password_is_required") })
    .min(8, {
      error: () => i18n.t("app:auth.password_must_be_at_least_8_characters"),
    }),
}) satisfies z.ZodType<AccessToken>

type FormData = z.infer<typeof formSchema>

export const Route = createFileRoute("/login")({
  component: Login,
  beforeLoad: async () => {
    if (await isLoggedIn()) {
      throw redirect({
        to: "/",
      })
    }
  },
  head: () => ({
    meta: [
      {
        title: i18n.t("app:auth.log_in_oblidog"),
      },
    ],
  }),
})

function Login() {
  useTranslation()

  const { loginMutation } = useAuth()
  const { data: appConfig } = usePublicAppConfig()
  const demoCredentials = appConfig?.demo_credentials
  const passwordChanged =
    new URLSearchParams(window.location.search).get("passwordChanged") ===
    "true"
  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    mode: "onBlur",
    criteriaMode: "all",
    defaultValues: {
      username: "",
      password: "",
    },
  })

  useEffect(() => {
    if (!demoCredentials) return
    form.reset({
      username: demoCredentials.email,
      password: demoCredentials.password,
    })
  }, [demoCredentials, form])

  const onSubmit = (data: FormData) => {
    if (loginMutation.isPending) return
    loginMutation.mutate(data)
  }

  return (
    <AuthLayout>
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="flex flex-col gap-6"
        >
          <div className="flex flex-col items-center gap-2 text-center">
            <h1 className="text-2xl font-bold">
              {i18n.t("app:auth.login_to_your_account")}
            </h1>
            {!appConfig?.is_demo && (
              <p className="text-sm text-muted-foreground">
                {i18n.t(
                  "app:auth.access_is_limited_to_users_invited_by_an_administrator",
                )}
              </p>
            )}
          </div>

          {passwordChanged && (
            <Alert data-testid="password-changed-message">
              <Info />
              <AlertTitle>{i18n.t("app:auth.password_updated")}</AlertTitle>
              <AlertDescription>
                {i18n.t(
                  "app:auth.your_sessions_were_signed_out_log_in_with_your_new_password",
                )}
              </AlertDescription>
            </Alert>
          )}

          <DemoBanner />
          <div className="grid gap-4">
            <FormField
              control={form.control}
              name="username"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{i18n.t("app:auth.email")}</FormLabel>
                  <FormControl>
                    <Input
                      data-testid="email-input"
                      placeholder="user@example.com"
                      type="email"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage className="text-xs" />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center">
                    <FormLabel>{i18n.t("app:auth.password")}</FormLabel>
                    {!appConfig?.is_demo && (
                      <RouterLink
                        to="/recover-password"
                        className="ml-auto text-sm underline-offset-4 hover:underline"
                      >
                        {i18n.t("app:auth.forgot_your_password")}
                      </RouterLink>
                    )}
                  </div>
                  <FormControl>
                    <PasswordInput
                      data-testid="password-input"
                      placeholder={i18n.t("app:auth.password")}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage className="text-xs" />
                </FormItem>
              )}
            />

            <LoadingButton type="submit" loading={loginMutation.isPending}>
              {appConfig?.is_demo
                ? i18n.t("app:auth.enter_demo")
                : i18n.t("app:auth.log_in")}
            </LoadingButton>
          </div>
        </form>
      </Form>
    </AuthLayout>
  )
}
