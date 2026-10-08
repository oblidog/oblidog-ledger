import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"
import { useForm } from "react-hook-form"

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
import { handleError } from "@/utils"

const queryKey = ["user-report-preferences"]

function ReportSettingsForm({
  preferences,
}: {
  preferences: UserReportPreferences
}) {
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
      showSuccessToast("Report preferences saved")
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
                <FormLabel>Daily report</FormLabel>
                <FormDescription>
                  Receive payment reminders, recent activity and integration
                  alerts when there is something to report.
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
                <FormLabel>Weekly report</FormLabel>
                <FormDescription>
                  Receive a monthly payment overview each Monday.
                </FormDescription>
              </div>
            </FormItem>
          )}
        />
        <p className="text-sm text-muted-foreground">
          Reports cover your active ledgers and follow the application's
          delivery schedule. Changes apply to future reports.
        </p>
        <LoadingButton
          type="submit"
          loading={mutation.isPending}
          disabled={!form.formState.isDirty}
          className="self-start"
        >
          Save
        </LoadingButton>
      </form>
    </Form>
  )
}

export default function ReportSettings() {
  const { data: appConfig, isPending: configPending } = usePublicAppConfig()
  const query = useQuery({
    queryKey,
    queryFn: () => UsersService.readReportPreferences(),
  })

  return (
    <div className="max-w-md">
      <h3 className="text-lg font-semibold py-4">Email reports</h3>
      {appConfig?.is_demo ? (
        <p className="text-sm text-muted-foreground">
          Email reports are disabled in the demo.
        </p>
      ) : query.isPending || configPending ? (
        <p role="status">Loading report preferences…</p>
      ) : query.isError ? (
        <div className="space-y-3">
          <p role="alert">Could not load report preferences.</p>
          <Button variant="outline" onClick={() => query.refetch()}>
            Retry
          </Button>
        </div>
      ) : (
        <ReportSettingsForm preferences={query.data} />
      )}
    </div>
  )
}
