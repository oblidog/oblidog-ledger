import { expect, test } from "@playwright/test"

test("displays the development application version fallback", async ({
  page,
}) => {
  await page.goto("/")

  await expect(page.getByTestId("app-version")).toHaveText("dev")
})
