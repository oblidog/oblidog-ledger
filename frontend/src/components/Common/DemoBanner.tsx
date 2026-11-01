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
    <Alert data-testid="demo-banner">
      <Info />
      <AlertTitle className="line-clamp-none">
        {appConfig.demo_writes_enabled === false
          ? i18n.t("app:common.public_demo_read_only")
          : i18n.t("app:common.public_demo")}
      </AlertTitle>
      <AlertDescription>
        {appConfig.demo_writes_enabled === false
          ? i18n.t(
              "app:common.the_demo_is_temporarily_read_only_you_can_sign_in_and_explore_the_existing_data_chang",
            )
          : i18n.t("app:auth.demo_shared_account_notice")}
      </AlertDescription>
    </Alert>
  )
}
