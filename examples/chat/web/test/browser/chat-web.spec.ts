import { expect, test } from "@playwright/test";

test("posts and reads a real Chat Projection through the local gateway", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Chat: general" })).toBeVisible();
  const message = `browser acceptance ${String(Date.now())}`;
  await page.getByRole("textbox", { name: "Message" }).fill(message);
  await page.getByRole("button", { name: "Post" }).click();
  await expect(page.getByRole("list", { name: "Messages" }).getByText(message)).toBeVisible();
});
