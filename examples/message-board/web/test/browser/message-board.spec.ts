/*
 * Copyright 2026, CodeMatters. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License
 * is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions and limitations under
 * the License.
 */

import { expect, test } from "@playwright/test";

test("posts and reads a real MessageBoard Projection through the local gateway", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Message Board");
  await expect(page.getByRole("heading", { name: "Message Board" })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("Updating live");

  await page.getByRole("textbox", { name: "Message" }).press("ControlOrMeta+Enter");
  await expect(page.getByText("Enter a username.")).toBeVisible();
  await expect(page.getByText("Enter a message.")).toBeVisible();

  const usernameInput = page.getByRole("textbox", { name: "Username" });
  await expect(usernameInput).toBeFocused();
  await expect(usernameInput).toHaveAttribute("aria-invalid", "true");

  const username = `visitor-${String(Date.now())}`;
  const message = `browser acceptance ${String(Date.now())}`;
  await usernameInput.fill(username);
  await page.getByRole("textbox", { name: "Message" }).fill(message);
  await page.getByRole("button", { name: "Post message" }).click();

  const messages = page.getByRole("list", { name: "Messages" });
  const posted = messages.getByRole("article").filter({ hasText: message });
  await expect(posted.getByText(username)).toBeVisible();
  await expect(posted.getByText(message)).toBeVisible();
  await expect(posted.getByText("just now")).toBeVisible();
  await expect(messages.getByRole("listitem").last()).toContainText(message);
});

test("keeps live updates connected beyond the former local timeout", async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "This timed acceptance is required only in Chromium.",
  );
  test.setTimeout(90_000);

  await page.goto("/");
  await expect(page.getByRole("status")).toHaveText("Updating live");
  await page.waitForTimeout(61_000);
  await expect(page.getByRole("status")).toHaveText("Updating live");

  const sender = await page.context().newPage();
  try {
    await sender.goto("/");
    await expect(sender.getByRole("status")).toHaveText("Updating live");
    const username = `boundary-${String(Date.now())}`;
    const message = `after former boundary ${String(Date.now())}`;
    await sender.getByRole("textbox", { name: "Username" }).fill(username);
    await sender.getByRole("textbox", { name: "Message" }).fill(message);
    await sender.getByRole("button", { name: "Post message" }).click();
    await expect(page.getByRole("list", { name: "Messages" }).getByText(message)).toBeVisible();
    await expect(sender.getByRole("button", { name: "Post message" })).toBeEnabled();
  } finally {
    await sender.close();
  }
});
