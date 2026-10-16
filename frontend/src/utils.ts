import { getApiErrorMessage } from "@/i18n/apiErrors"

export const handleError = function (
  this: (msg: string) => void,
  err: unknown,
) {
  this(getApiErrorMessage(err))
}

export const getInitials = (name: string): string => {
  return name
    .split(" ")
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase()
}
