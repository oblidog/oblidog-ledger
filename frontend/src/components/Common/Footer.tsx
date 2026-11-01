import { useTranslation } from "react-i18next"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

export function Footer() {
  const { t } = useTranslation()
  const currentYear = new Date().getFullYear()

  return (
    <footer className="border-t px-6 py-4">
      <div className="flex flex-wrap items-center justify-center gap-x-1 text-muted-foreground text-sm">
        <span>Oblidog · {currentYear} ·</span>
        <Dialog>
          <DialogTrigger asChild>
            <button
              type="button"
              data-testid="app-version"
              aria-label={`${t("footer.versionDetails")}: ${__APP_BUILD__.label}`}
              className="rounded-sm underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
            >
              {__APP_BUILD__.label}
            </button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("footer.versionDetails")}</DialogTitle>
              <DialogDescription>{__APP_BUILD__.label}</DialogDescription>
            </DialogHeader>
            <dl className="min-w-0 text-sm">
              <dt className="text-muted-foreground">{t("footer.commit")}</dt>
              <dd
                className="mt-1 select-all break-all font-mono"
                data-testid="app-commit"
              >
                {__APP_BUILD__.commit ?? t("footer.commitUnavailable")}
              </dd>
            </dl>
          </DialogContent>
        </Dialog>
      </div>
    </footer>
  )
}
