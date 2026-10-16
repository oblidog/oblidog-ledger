import { Link } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { i18n } from "@/i18n"

const ErrorComponent = () => {
  useTranslation()

  return (
    <div
      className="flex min-h-screen items-center justify-center flex-col p-4"
      data-testid="error-component"
    >
      <div className="flex items-center z-10">
        <div className="flex flex-col ml-4 items-center justify-center p-4">
          <span className="text-6xl md:text-8xl font-bold leading-none mb-4">
            {i18n.t("app:common.error")}
          </span>
          <span className="text-2xl font-bold mb-2">
            {i18n.t("app:common.oops")}
          </span>
        </div>
      </div>

      <p className="text-lg text-muted-foreground mb-4 text-center z-10">
        {i18n.t("app:common.something_went_wrong_please_try_again")}
      </p>
      <Link to="/">
        <Button>{i18n.t("app:common.go_home")}</Button>
      </Link>
    </div>
  )
}

export default ErrorComponent
