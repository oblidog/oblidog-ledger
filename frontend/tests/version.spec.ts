import { expect, test } from "@playwright/test"

test("version details are keyboard accessible", async ({ page }) => {
  await page.goto("/login")

  const version = page.getByTestId("app-version")
  await expect(version).toHaveText(/^(v?\d+\.\d+\.\d+|dev\.unknown)/)
  await version.focus()
  await page.keyboard.press("Enter")
  await expect(page.getByRole("dialog")).toBeVisible()
  await expect(page.getByTestId("app-commit")).not.toBeEmpty()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog")).not.toBeVisible()
  await expect(version).toBeFocused()
})
