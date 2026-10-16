import { Info } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { usePublicAppConfig } from "@/hooks/usePublicAppConfig"
import { i18n } from "@/i18n"

export function DemoBanner() {
  useTranslation()

  const { data: appConfig } = usePublicAppConfig()

  if (!appConfig?.is_demo) return null

  return (
    <Alert
      className="rounded-none border-x-0 border-t-0"
      data-testid="demo-banner"
    >
      <Info />
      <AlertTitle>
        {appConfig.demo_writes_enabled === false
          ? i18n.t("app:common.public_demo_read_only")
          : i18n.t("app:common.public_demo")}
      </AlertTitle>
      <AlertDescription>
        {appConfig.demo_writes_enabled === false
          ? i18n.t(
              "app:common.the_demo_is_temporarily_read_only_you_can_sign_in_and_explore_the_existing_data_chang",
            )
          : i18n.t(
              "app:common.this_is_a_shared_demo_environment_changes_are_visible_to_other_visitors_and_the_demo_",
            )}
      </AlertDescription>
    </Alert>
  )
}
