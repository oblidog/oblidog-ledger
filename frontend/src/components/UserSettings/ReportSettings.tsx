import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"
import { useTranslation } from "react-i18next"
import {
  type UserReportPreferences,
  type UserReportPreferencesUpdate,
  UsersService,
} from "@/client"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
} from "@/components/ui/form"
import { LoadingButton } from "@/components/ui/loading-button"
import useCustomToast from "@/hooks/useCustomToast"
import { usePublicAppConfig } from "@/hooks/usePublicAppConfig"
import { i18n } from "@/i18n"
import { useLocalizedForm as useForm } from "@/i18n/useLocalizedForm"
import { handleError } from "@/utils"

const queryKey = ["user-report-preferences"]

function ReportSettingsForm({
  preferences,
}: {
  preferences: UserReportPreferences
}) {
  useTranslation()

  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const form = useForm<UserReportPreferences>({
    defaultValues: preferences,
  })
  const { reset } = form
  useEffect(() => {
    reset(preferences, { keepDirtyValues: true, keepDirty: true })
  }, [preferences, reset])
  const { dirtyFields } = form.formState
  const mutation = useMutation({
    mutationFn: (requestBody: UserReportPreferencesUpdate) =>
      UsersService.updateReportPreferences({ requestBody }),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKey, data)
      form.reset(data)
      showSuccessToast(i18n.t("app:usersettings.report_preferences_saved"))
    },
    onError: handleError.bind(showErrorToast),
  })

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit((data) => {
          const updates: UserReportPreferencesUpdate = {}
          if (dirtyFields.daily_report_enabled) {
            updates.daily_report_enabled = data.daily_report_enabled
          }
          if (dirtyFields.weekly_report_enabled) {
            updates.weekly_report_enabled = data.weekly_report_enabled
          }
          mutation.mutate(updates)
        })}
        className="flex flex-col gap-6"
      >
        <FormField
          control={form.control}
          name="daily_report_enabled"
          render={({ field }) => (
            <FormItem className="flex items-start gap-3">
              <FormControl>
                <Checkbox
                  checked={field.value}
                  onCheckedChange={(checked) =>
                    field.onChange(checked === true)
                  }
                  disabled={mutation.isPending}
                />
              </FormControl>
              <div className="space-y-1">
                <FormLabel>{i18n.t("app:usersettings.daily_report")}</FormLabel>
                <FormDescription>
                  {i18n.t(
                    "app:usersettings.receive_payment_reminders_recent_activity_and_integration_alerts_when_there_is_someth",
                  )}
                </FormDescription>
              </div>
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="weekly_report_enabled"
          render={({ field }) => (
            <FormItem className="flex items-start gap-3">
              <FormControl>
                <Checkbox
                  checked={field.value}
                  onCheckedChange={(checked) =>
                    field.onChange(checked === true)
                  }
                  disabled={mutation.isPending}
                />
              </FormControl>
              <div className="space-y-1">
                <FormLabel>
                  {i18n.t("app:usersettings.weekly_report")}
                </FormLabel>
                <FormDescription>
                  {i18n.t(
                    "app:usersettings.receive_a_monthly_payment_overview_each_monday",
                  )}
                </FormDescription>
              </div>
            </FormItem>
          )}
        />
        <p className="text-sm text-muted-foreground">
          {i18n.t(
            "app:usersettings.reports_cover_your_active_ledgers_and_follow_the_application_s_delivery_schedule_chan",
          )}
        </p>
        <LoadingButton
          type="submit"
          loading={mutation.isPending}
          disabled={!form.formState.isDirty}
          className="self-start"
        >
          {i18n.t("app:usersettings.save")}
        </LoadingButton>
      </form>
    </Form>
  )
}

export default function ReportSettings() {
  useTranslation()

  const { isPending: configPending } = usePublicAppConfig()
  const query = useQuery({
    queryKey,
    queryFn: () => UsersService.readReportPreferences(),
  })

  return (
    <div className="max-w-md">
      <h3 className="text-lg font-semibold py-4">
        {i18n.t("app:usersettings.email_reports")}
      </h3>
      {query.isPending || configPending ? (
        <p role="status">
          {i18n.t("app:usersettings.loading_report_preferences")}
        </p>
      ) : query.isError ? (
        <div className="space-y-3">
          <p role="alert">
            {i18n.t("app:usersettings.could_not_load_report_preferences")}
          </p>
          <Button variant="outline" onClick={() => query.refetch()}>
            {i18n.t("app:usersettings.retry")}
          </Button>
        </div>
      ) : (
        <ReportSettingsForm preferences={query.data} />
      )}
    </div>
  )
}
