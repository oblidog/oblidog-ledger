import { useId } from "react"
import { useTranslation } from "react-i18next"
import { useLanguage } from "@/i18n/LanguageProvider"
import { supportedLanguage } from "@/i18n/language"

export function LanguageSelector() {
  const id = useId()
  const { t, i18n } = useTranslation()
  const { changeLanguage, disabled, isSaving } = useLanguage()
  return (
    <div className="flex min-w-0 items-center gap-2 px-2 py-1 group-data-[collapsible=icon]:hidden">
      <label htmlFor={id} className="text-sm">
        {t("language.title")}
      </label>
      <select
        id={id}
        data-testid="language-selector"
        value={i18n.resolvedLanguage ?? "en"}
        disabled={disabled}
        aria-busy={isSaving}
        className="min-h-9 min-w-0 rounded-md border bg-background px-2 text-sm"
        onChange={(event) => {
          const selected = supportedLanguage(event.target.value)
          if (selected) changeLanguage(selected)
        }}
      >
        <option value="en" lang="en">
          English
        </option>
        <option value="pl" lang="pl">
          Polski
        </option>
      </select>
      {isSaving && (
        <span role="status" className="sr-only">
          {t("language.saving")}
        </span>
      )}
    </div>
  )
}
