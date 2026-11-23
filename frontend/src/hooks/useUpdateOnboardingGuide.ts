import { useMutation, useQueryClient } from "@tanstack/react-query"
import { type UserPublic, UsersService } from "@/client"
import { onboardingGuideVersionKey } from "@/lib/onboardingGuide"
import { handleError } from "@/utils"
import useCustomToast from "./useCustomToast"

export function useUpdateOnboardingGuide() {
  const queryClient = useQueryClient()
  const { showErrorToast } = useCustomToast()
  const currentUserKey = ["currentUser"]

  return useMutation({
    mutationFn: (enabled: boolean) =>
      UsersService.updateUserMe({
        requestBody: { onboarding_guide_enabled: enabled },
      }),
    onSuccess: async (updated) => {
      if (updated.onboarding_guide_enabled === false) {
        // Invalidate pending completion messages in all tabs for this account.
        const version = crypto.getRandomValues(new Uint32Array(2)).join("-")
        localStorage.setItem(onboardingGuideVersionKey(updated.id), version)
      }

      const current = queryClient.getQueryData<UserPublic>(currentUserKey)
      if (current?.id !== updated.id) return

      await queryClient.cancelQueries({ queryKey: currentUserKey })
      queryClient.setQueryData<UserPublic>(currentUserKey, (user) =>
        user?.id === updated.id
          ? {
              ...user,
              onboarding_guide_enabled: updated.onboarding_guide_enabled,
            }
          : user,
      )
    },
    onError: handleError.bind(showErrorToast),
  })
}
