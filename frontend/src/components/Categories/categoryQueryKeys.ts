export const categoryQueryKeys = {
  categories: (ledgerId: string) => ["categories", ledgerId] as const,
  list: (ledgerId: string, includeArchived: boolean) =>
    ["categories", ledgerId, includeArchived] as const,
  groups: (ledgerId: string) => ["category-groups", ledgerId] as const,
  groupList: (ledgerId: string, includeArchived: boolean) =>
    ["category-groups", ledgerId, includeArchived] as const,
}
