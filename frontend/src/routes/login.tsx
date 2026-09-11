import { zodResolver } from "@hookform/resolvers/zod"
import {
  createFileRoute,
  Link as RouterLink,
  redirect,
} from "@tanstack/react-router"
import { Info } from "lucide-react"
import { useEffect } from "react"
import { useForm } from "react-hook-form"
import { z } from "zod"

import type { Body_login_login_access_token as AccessToken } from "@/client"
import { AuthLayout } from "@/components/Common/AuthLayout"
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

const formSchema = z.object({
  username: z.email(),
  password: z
    .string()
    .min(1, { message: "Password is required" })
    .min(8, { message: "Password must be at least 8 characters" }),
}) satisfies z.ZodType<AccessToken>

type FormData = z.infer<typeof formSchema>

export const Route = createFileRoute("/login")({
  component: Login,
  beforeLoad: async () => {
    if (isLoggedIn()) {
      throw redirect({
        to: "/",
      })
    }
  },
  head: () => ({
    meta: [
      {
        title: "Log In - Oblidog",
      },
    ],
  }),
})

function Login() {
  const { loginMutation } = useAuth()
  const { data: appConfig } = usePublicAppConfig()
  const demoCredentials = appConfig?.demo_credentials
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
            <h1 className="text-2xl font-bold">Login to your account</h1>
            <p className="text-sm text-muted-foreground">
              {appConfig?.is_demo
                ? "Explore Oblidog using the shared public demo account."
                : "Access is limited to users provisioned by an administrator."}
            </p>
          </div>

          {appConfig?.is_demo && demoCredentials && (
            <Alert data-testid="demo-credentials">
              <Info />
              <AlertTitle>Public demo credentials</AlertTitle>
              <AlertDescription className="space-y-1">
                <p>
                  Email: <strong>{demoCredentials.email}</strong>
                </p>
                <p>
                  Password: <strong>{demoCredentials.password}</strong>
                </p>
                <p className="pt-1">
                  The fields below are prefilled. Demo data is periodically
                  reset.
                </p>
              </AlertDescription>
            </Alert>
          )}

          <div className="grid gap-4">
            <FormField
              control={form.control}
              name="username"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
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
                    <FormLabel>Password</FormLabel>
                    {!appConfig?.is_demo && (
                      <RouterLink
                        to="/recover-password"
                        className="ml-auto text-sm underline-offset-4 hover:underline"
                      >
                        Forgot your password?
                      </RouterLink>
                    )}
                  </div>
                  <FormControl>
                    <PasswordInput
                      data-testid="password-input"
                      placeholder="Password"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage className="text-xs" />
                </FormItem>
              )}
            />

            <LoadingButton type="submit" loading={loginMutation.isPending}>
              Log In
            </LoadingButton>
          </div>
        </form>
      </Form>
    </AuthLayout>
  )
}
