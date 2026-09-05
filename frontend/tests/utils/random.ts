const randomSuffix = () => crypto.randomUUID().replaceAll("-", "").slice(0, 10)

export const randomEmail = () => `test_${randomSuffix()}@example.com`

export const randomTeamName = () => `Team ${randomSuffix()}`

export const randomPassword = () => crypto.randomUUID().replaceAll("-", "")

export const slugify = (text: string) =>
  text
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\w-]+/g, "")
