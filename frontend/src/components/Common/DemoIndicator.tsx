import { Info } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { usePublicAppConfig } from "@/hooks/usePublicAppConfig"
import { i18n } from "@/i18n"

export function DemoIndicator() {
  useTranslation()
  const { data: config } = usePublicAppConfig()
  if (!config?.is_demo) return null
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          data-testid="demo-indicator"
          aria-label={i18n.t("app:common.demo_info")}
        >
          {i18n.t("app:common.demo_badge")} <Info className="size-3.5" />
          {config.demo_writes_enabled === false && (
            <span>{i18n.t("app:common.demo_read_only_badge")}</span>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{i18n.t("app:common.public_demo")}</DialogTitle>
          <DialogDescription>
            {i18n.t(
              "app:common.this_is_a_shared_demo_environment_changes_are_visible_to_other_visitors_and_the_demo_",
            )}
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {i18n.t("app:common.demo_limits_description")}
        </p>
        {config.demo_writes_enabled === false && (
          <p className="text-sm font-medium">
            {i18n.t(
              "app:common.the_demo_is_temporarily_read_only_you_can_sign_in_and_explore_the_existing_data_chang",
            )}
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}
