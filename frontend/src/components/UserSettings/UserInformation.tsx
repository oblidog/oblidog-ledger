import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useId, useState } from "react"
import { useTranslation } from "react-i18next"
import { z } from "zod"
import { UsersService, type UserUpdateMe } from "@/client"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LoadingButton } from "@/components/ui/loading-button"
import useAuth from "@/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"
import { useUpdateOnboardingGuide } from "@/hooks/useUpdateOnboardingGuide"
import { i18n } from "@/i18n"
import { useLocalizedForm as useForm } from "@/i18n/useLocalizedForm"
import { cn } from "@/lib/utils"
import { handleError } from "@/utils"

const formSchema = z.object({
  full_name: z.string().max(30).optional(),
  email: z.email({
    error: () => i18n.t("app:usersettings.invalid_email_address"),
  }),
})

type FormData = z.infer<typeof formSchema>

const UserInformation = () => {
  useTranslation()

  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [editMode, setEditMode] = useState(false)
  const { user: currentUser } = useAuth()
  const guideId = useId()
  const updateGuide = useUpdateOnboardingGuide()

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    mode: "onBlur",
    criteriaMode: "all",
    defaultValues: {
      full_name: currentUser?.full_name ?? undefined,
      email: currentUser?.email,
    },
  })

  const toggleEditMode = () => {
    setEditMode(!editMode)
  }

  const mutation = useMutation({
    mutationFn: (data: UserUpdateMe) =>
      UsersService.updateUserMe({ requestBody: data }),
    onSuccess: () => {
      showSuccessToast(i18n.t("app:usersettings.user_updated_successfully"))
      toggleEditMode()
    },
    onError: handleError.bind(showErrorToast),
    onSettled: () => {
      queryClient.invalidateQueries()
    },
  })

  const onSubmit = (data: FormData) => {
    const updateData: UserUpdateMe = {}

    // only include fields that have changed
    if (data.full_name !== currentUser?.full_name) {
      updateData.full_name = data.full_name
    }
    if (data.email !== currentUser?.email) {
      updateData.email = data.email
    }

    mutation.mutate(updateData)
  }

  const onCancel = () => {
    form.reset()
    toggleEditMode()
  }

  return (
    <div className="max-w-md">
      <h3 className="text-lg font-semibold py-4">
        {i18n.t("app:usersettings.user_information")}
      </h3>
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="flex flex-col gap-4"
        >
          <FormField
            control={form.control}
            name="full_name"
            render={({ field }) =>
              editMode ? (
                <FormItem>
                  <FormLabel>{i18n.t("app:usersettings.full_name")}</FormLabel>
                  <FormControl>
                    <Input type="text" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              ) : (
                <FormItem>
                  <FormLabel>{i18n.t("app:usersettings.full_name")}</FormLabel>
                  <p
                    className={cn(
                      "py-2 truncate max-w-sm",
                      !field.value && "text-muted-foreground",
                    )}
                  >
                    {field.value || i18n.t("app:usersettings.n_a")}
                  </p>
                </FormItem>
              )
            }
          />

          <FormField
            control={form.control}
            name="email"
            render={({ field }) =>
              editMode ? (
                <FormItem>
                  <FormLabel>{i18n.t("app:usersettings.email")}</FormLabel>
                  <FormControl>
                    <Input type="email" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              ) : (
                <FormItem>
                  <FormLabel>{i18n.t("app:usersettings.email")}</FormLabel>
                  <p className="py-2 truncate max-w-sm">{field.value}</p>
                </FormItem>
              )
            }
          />

          <div className="flex gap-3">
            {editMode ? (
              <>
                <LoadingButton
                  type="submit"
                  loading={mutation.isPending}
                  disabled={!form.formState.isDirty}
                >
                  {i18n.t("app:usersettings.save")}
                </LoadingButton>
                <Button
                  type="button"
                  variant="outline"
                  onClick={onCancel}
                  disabled={mutation.isPending}
                >
                  {i18n.t("app:usersettings.cancel")}
                </Button>
              </>
            ) : (
              <Button type="button" onClick={toggleEditMode}>
                {i18n.t("app:usersettings.edit")}
              </Button>
            )}
          </div>
        </form>
      </Form>
      <div className="mt-6 flex items-start gap-3 border-t pt-6">
        <Checkbox
          id={guideId}
          className="mt-0.5"
          aria-describedby={`${guideId}-description`}
          checked={currentUser?.onboarding_guide_enabled !== false}
          onCheckedChange={(checked) => updateGuide.mutate(checked === true)}
          disabled={updateGuide.isPending}
        />
        <div className="space-y-1">
          <Label htmlFor={guideId}>{i18n.t("app:onboarding.preference")}</Label>
          <p
            id={`${guideId}-description`}
            className="text-sm text-muted-foreground"
          >
            {i18n.t("app:onboarding.preference_help")}
          </p>
        </div>
      </div>
    </div>
  )
}

export default UserInformation
