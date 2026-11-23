import { useMutation, useQueryClient } from "@tanstack/react-query"
import { type UserPublic, UsersService } from "@/client"
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
