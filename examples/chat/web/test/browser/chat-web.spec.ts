import { expect, test } from "@playwright/test";

test("uses one authoritative recovery response and tears down its subscription", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Chat: general" })).toBeVisible();
  await expect(page.getByText("initial fixture message")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.chatBrowserFixture.active())).toBe(true);
  await expect.poll(() => page.evaluate(() => window.chatBrowserFixture.queryCount())).toBe(1);
  await page.evaluate(() => {
    window.chatBrowserFixture.recover();
  });
  await expect(page.getByText("recovered fixture message")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.chatBrowserFixture.queryCount())).toBe(1);
  await page.evaluate(() => {
    window.chatBrowserFixture.gap();
  });
  await expect.poll(() => page.evaluate(() => window.chatBrowserFixture.queryCount())).toBe(2);
  await page.evaluate(() => {
    window.chatBrowserFixture.teardown();
    window.chatBrowserFixture.resolveLate();
  });
  await expect.poll(() => page.evaluate(() => window.chatBrowserFixture.active())).toBe(false);
  await expect(page.locator("main")).toHaveCount(0);
  await expect(page.getByText("late fixture message")).toHaveCount(0);
});
