import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { z } from "zod"
import { clearBrowserSessionState } from "@/browserSession"
import { LoginService, type UpdatePassword, UsersService } from "@/client"
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
import useCustomToast from "@/hooks/useCustomToast"
import { i18n } from "@/i18n"
import { useLocalizedForm as useForm } from "@/i18n/useLocalizedForm"
import { handleError } from "@/utils"

const formSchema = z
  .object({
    current_password: z
      .string()
      .min(1, { error: () => i18n.t("app:usersettings.password_is_required") })
      .min(8, {
        error: () =>
          i18n.t("app:usersettings.password_must_be_at_least_8_characters"),
      }),
    new_password: z
      .string()
      .min(1, { error: () => i18n.t("app:usersettings.password_is_required") })
      .min(8, {
        error: () =>
          i18n.t("app:usersettings.password_must_be_at_least_8_characters"),
      }),
    confirm_password: z.string().min(1, {
      error: () => i18n.t("app:usersettings.password_confirmation_is_required"),
    }),
  })
  .refine((data) => data.new_password === data.confirm_password, {
    error: () => i18n.t("app:usersettings.the_passwords_don_t_match"),
    path: ["confirm_password"],
  })

type FormData = z.infer<typeof formSchema>

const ChangePassword = () => {
  useTranslation()

  const { showErrorToast } = useCustomToast()
  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    mode: "onSubmit",
    criteriaMode: "all",
    defaultValues: {
      current_password: "",
      new_password: "",
      confirm_password: "",
    },
  })

  const mutation = useMutation({
    mutationFn: (data: UpdatePassword) =>
      UsersService.updatePasswordMe({ requestBody: data }),
    onSuccess: async () => {
      try {
        await LoginService.logout()
      } finally {
        clearBrowserSessionState()
        window.location.replace("/login?passwordChanged=true")
      }
    },
    onError: handleError.bind(showErrorToast),
  })

  const onSubmit = async (data: FormData) => {
    mutation.mutate(data)
  }

  return (
    <div className="max-w-md">
      <h3 className="text-lg font-semibold py-4">
        {i18n.t("app:usersettings.change_password")}
      </h3>
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="flex flex-col gap-4"
        >
          <FormField
            control={form.control}
            name="current_password"
            render={({ field, fieldState }) => (
              <FormItem>
                <FormLabel>
                  {i18n.t("app:usersettings.current_password")}
                </FormLabel>
                <FormControl>
                  <PasswordInput
                    data-testid="current-password-input"
                    placeholder="••••••••"
                    aria-invalid={fieldState.invalid}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="new_password"
            render={({ field, fieldState }) => (
              <FormItem>
                <FormLabel>{i18n.t("app:usersettings.new_password")}</FormLabel>
                <FormControl>
                  <PasswordInput
                    data-testid="new-password-input"
                    placeholder="••••••••"
                    aria-invalid={fieldState.invalid}
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
            render={({ field, fieldState }) => (
              <FormItem>
                <FormLabel>
                  {i18n.t("app:usersettings.confirm_password")}
                </FormLabel>
                <FormControl>
                  <PasswordInput
                    data-testid="confirm-password-input"
                    placeholder="••••••••"
                    aria-invalid={fieldState.invalid}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <LoadingButton
            type="submit"
            loading={mutation.isPending}
            className="self-start"
          >
            {i18n.t("app:usersettings.update_password")}
          </LoadingButton>
        </form>
      </Form>
    </div>
  )
}

export default ChangePassword
