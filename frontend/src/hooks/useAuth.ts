import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { useEffect } from "react"
import { clearBrowserSessionState } from "@/browserSession"
import {
  type Body_login_login_access_token as AccessToken,
  ApiError,
  LedgersService,
  LoginService,
  type UserPublic,
  UsersService,
} from "@/client"
import { handleError } from "@/utils"
import useCustomToast from "./useCustomToast"

const isLoggedIn = async () => {
  try {
    await UsersService.readUserMe()
    return true
  } catch {
    return false
  }
}

const isCurrentUserSessionError = (error: unknown) =>
  error instanceof ApiError &&
  [400, 401, 403, 404].includes(error.response?.status ?? 0)

const useAuth = () => {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { showErrorToast } = useCustomToast()

  const { data: user, error: currentUserError } = useQuery<
    UserPublic | null,
    Error
  >({
    queryKey: ["currentUser"],
    queryFn: () => UsersService.readUserMe(),
    enabled: window.location.pathname !== "/login",
    retry: (failureCount, error) =>
      !isCurrentUserSessionError(error) && failureCount < 3,
  })

  useEffect(() => {
    if (!isCurrentUserSessionError(currentUserError)) return
    if (window.location.pathname === "/login") return
    window.location.replace("/login")
  }, [currentUserError])

  const login = async (data: AccessToken) => {
    await LoginService.loginSession({
      formData: data,
    })
  }

  const loginMutation = useMutation({
    mutationFn: login,
    onSuccess: async () => {
      try {
        const ledgers = await LedgersService.readLedgers()
        const lastLedgerId = localStorage.getItem("last-ledger-id")
        const activeLedger = ledgers.data.find(
          (ledger) => ledger.id === lastLedgerId,
        )
        const ledger = activeLedger ?? ledgers.data[0]

        if (ledger) {
          navigate({
            to: "/ledgers/$ledgerId",
            params: { ledgerId: ledger.id },
          })
          return
        }
      } catch {
        // The session is valid even when the optional landing lookup fails.
      }

      navigate({ to: "/" })
    },
    onError: handleError.bind(showErrorToast),
  })

  const logout = async () => {
    try {
      await LoginService.logout()
    } catch (error) {
      if (error instanceof ApiError) {
        handleError.call(showErrorToast, error)
      } else {
        showErrorToast("Unable to log out. Please try again.")
      }
      return
    }

    clearBrowserSessionState()
    queryClient.clear()
    navigate({ to: "/login" })
  }

  return {
    loginMutation,
    logout,
    user,
  }
}

export { isLoggedIn }
export default useAuth
