import { Link } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { i18n } from "@/i18n"

const NotFound = () => {
  useTranslation()

  return (
    <div
      className="flex min-h-screen items-center justify-center flex-col p-4"
      data-testid="not-found"
    >
      <div className="flex items-center z-10">
        <div className="flex flex-col ml-4 items-center justify-center p-4">
          <span className="text-6xl md:text-8xl font-bold leading-none mb-4">
            404
          </span>
          <span className="text-2xl font-bold mb-2">
            {i18n.t("app:common.oops")}
          </span>
        </div>
      </div>

      <p className="text-lg text-muted-foreground mb-4 text-center z-10">
        {i18n.t("app:common.the_page_you_are_looking_for_was_not_found")}
      </p>
      <div className="z-10">
        <Link to="/">
          <Button className="mt-4">{i18n.t("app:common.go_back")}</Button>
        </Link>
      </div>
    </div>
  )
}

export default NotFound
