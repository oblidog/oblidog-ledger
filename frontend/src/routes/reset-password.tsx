import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation } from "@tanstack/react-query"
import {
  createFileRoute,
  Link as RouterLink,
  redirect,
  useNavigate,
} from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import { z } from "zod"
import { LoginService } from "@/client"
import { AuthLayout } from "@/components/Common/AuthLayout"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { LoadingButton } from "@/components/ui/loading-button"
import { PasswordInput } from "@/components/ui/password-input"
import { isLoggedIn } from "@/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"
import { i18n } from "@/i18n"
import { useLocalizedForm as useForm } from "@/i18n/useLocalizedForm"
import { handleError } from "@/utils"

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

export const Route = createFileRoute("/reset-password")({
  component: ResetPassword,
  validateSearch: searchSchema,
  beforeLoad: async ({ search }) => {
    if (await isLoggedIn()) {
      throw redirect({ to: "/" })
    }
    if (!search.token) {
      throw redirect({ to: "/login" })
    }
  },
  head: () => ({
    meta: [
      {
        title: i18n.t("app:auth.reset_password_oblidog"),
      },
    ],
  }),
})

function ResetPassword() {
  useTranslation()

  const { token } = Route.useSearch()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const navigate = useNavigate()

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    mode: "onBlur",
    criteriaMode: "all",
    defaultValues: {
      new_password: "",
      confirm_password: "",
    },
  })

  const mutation = useMutation({
    mutationFn: (data: { new_password: string; token: string }) =>
      LoginService.resetPassword({ requestBody: data }),
    onSuccess: () => {
      showSuccessToast(i18n.t("app:auth.password_updated_successfully"))
      form.reset()
      navigate({ to: "/login" })
    },
    onError: handleError.bind(showErrorToast),
  })

  const onSubmit = (data: FormData) => {
    mutation.mutate({ new_password: data.new_password, token })
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
              {i18n.t("app:auth.reset_password")}
            </h1>
          </div>

          <div className="grid gap-4">
            <FormField
              control={form.control}
              name="new_password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{i18n.t("app:auth.new_password")}</FormLabel>
                  <FormControl>
                    <PasswordInput
                      data-testid="new-password-input"
                      placeholder={i18n.t("app:auth.new_password")}
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
                      placeholder={i18n.t("app:auth.confirm_password")}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <LoadingButton
              type="submit"
              className="w-full"
              loading={mutation.isPending}
            >
              {i18n.t("app:auth.reset_password")}
            </LoadingButton>
          </div>

          <div className="text-center text-sm">
            {i18n.t("app:auth.remember_your_password")}{" "}
            <RouterLink to="/login" className="underline underline-offset-4">
              {i18n.t("app:auth.log_in_f7c400")}
            </RouterLink>
          </div>
        </form>
      </Form>
    </AuthLayout>
  )
}
