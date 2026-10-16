import { toast } from "sonner"
import { i18n } from "@/i18n"

const useCustomToast = () => {
  const showSuccessToast = (description: string) => {
    toast.success(i18n.t("app:common.success"), {
      description,
    })
  }

  const showErrorToast = (description: string) => {
    toast.error(i18n.t("app:common.something_went_wrong"), {
      description,
    })
  }

  return { showSuccessToast, showErrorToast }
}

export default useCustomToast
