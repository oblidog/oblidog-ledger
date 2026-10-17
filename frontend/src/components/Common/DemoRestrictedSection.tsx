import { type ReactNode, useId } from "react"
import { useTranslation } from "react-i18next"
import { usePublicAppConfig } from "@/hooks/usePublicAppConfig"
import { i18n } from "@/i18n"

// Native fieldsets block controls and form submission while leaving links,
// tabs and readable content available. Fail closed until config is loaded.
export function DemoRestrictedSection({ children }: { children: ReactNode }) {
  useTranslation()
  const { data: config } = usePublicAppConfig()
  const descriptionId = useId()
  return (
    <div className="min-w-0 space-y-4">
      {config?.is_demo && (
        <p id={descriptionId} className="text-sm text-muted-foreground">
          {i18n.t("app:common.demo_restricted_description")}
        </p>
      )}
      <fieldset
        disabled={!config || config.is_demo}
        aria-describedby={config?.is_demo ? descriptionId : undefined}
        className="min-w-0 space-y-6"
      >
        {children}
      </fieldset>
    </div>
  )
}

export function DemoPreviewNotice() {
  useTranslation()
  return (
    <p
      data-testid="demo-preview-notice"
      className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground"
    >
      {i18n.t("app:common.demo_sample_data")}{" "}
      {i18n.t("app:common.demo_restricted")}
    </p>
  )
}
