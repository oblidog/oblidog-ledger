import { useTranslation } from "react-i18next"
import { i18n } from "@/i18n"
import DeleteConfirmation from "./DeleteConfirmation"

const DeleteAccount = () => {
  useTranslation()

  return (
    <div className="max-w-md mt-4 rounded-lg border border-destructive/50 p-4">
      <h3 className="font-semibold text-destructive">
        {i18n.t("app:usersettings.delete_account")}
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">
        {i18n.t(
          "app:usersettings.permanently_delete_your_account_and_all_associated_data",
        )}
      </p>
      <DeleteConfirmation />
    </div>
  )
}

export default DeleteAccount
