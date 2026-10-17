import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { CategoriesService } from "@/client"
import useCustomToast from "@/hooks/useCustomToast"
import { handleError } from "@/utils"
import { categoryQueryKeys } from "./categoryQueryKeys"

export function useCategoryQueries(ledgerId: string, includeArchived: boolean) {
  const groups = useSuspenseQuery({
    queryFn: () =>
      CategoriesService.readCategoryGroups({ ledgerId, includeArchived }),
    queryKey: categoryQueryKeys.groupList(ledgerId, includeArchived),
  })
  const categories = useSuspenseQuery({
    queryFn: () =>
      CategoriesService.readCategories({ ledgerId, includeArchived }),
    queryKey: categoryQueryKeys.list(ledgerId, includeArchived),
  })

  return { categories: categories.data.data, groups: groups.data.data }
}

export function useCategoryArchiveActions(ledgerId: string) {
  const { t } = useTranslation(["common", "app"])
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const archiveGroup = useMutation({
    mutationFn: (groupId: string) =>
      CategoriesService.archiveCategoryGroup({
        ledgerId,
        categoryGroupId: groupId,
      }),
    onSuccess: () =>
      showSuccessToast(t("app:categories.category_group_archived")),
    onError: handleError.bind(showErrorToast),
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: categoryQueryKeys.groups(ledgerId),
      })
      queryClient.invalidateQueries({
        queryKey: categoryQueryKeys.categories(ledgerId),
      })
    },
  })
  const archiveCategory = useMutation({
    mutationFn: (categoryId: string) =>
      CategoriesService.archiveCategory({ ledgerId, categoryId }),
    onSuccess: () => showSuccessToast(t("app:categories.category_archived")),
    onError: handleError.bind(showErrorToast),
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: categoryQueryKeys.categories(ledgerId),
      }),
  })
  const restoreCategory = useMutation({
    mutationFn: (categoryId: string) =>
      CategoriesService.restoreCategory({ ledgerId, categoryId }),
    onSuccess: () => showSuccessToast(t("app:categories.category_restored")),
    onError: handleError.bind(showErrorToast),
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: categoryQueryKeys.categories(ledgerId),
      }),
  })

  return { archiveGroup, archiveCategory, restoreCategory }
}
