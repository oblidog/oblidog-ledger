import type { AxiosError } from "axios"
import { i18n } from "@/i18n"

function extractErrorMessage(err: AxiosError): string {
  const errDetail = (err.response?.data as any)?.detail
  if (Array.isArray(errDetail) && errDetail.length > 0) {
    return errDetail[0].msg
  }
  return errDetail || i18n.t("app:messages.generic_error")
}

export const handleError = function (
  this: (msg: string) => void,
  err: AxiosError,
) {
  const errorMessage = extractErrorMessage(err)
  this(errorMessage)
}

export const getInitials = (name: string): string => {
  return name
    .split(" ")
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase()
}
