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

test("signed readers see only their verified board data across account switches", async ({
  page,
}) => {
  const granted = process.env.MESSAGE_BOARD_TEST_GRANTED;
  const ordinary = process.env.MESSAGE_BOARD_TEST_ORDINARY;
  test.skip(granted === undefined || ordinary === undefined, "Signed Gateway fixture is required.");
  if (granted === undefined || ordinary === undefined) return;
  await page.goto("/");
  const credential = page.getByRole("textbox", { name: "Issued bearer credential" });
  await credential.fill("invalid-credential");
  await page.getByRole("button", { name: "Use credential" }).click();
  await expect(page.getByRole("alert")).toContainText("Credential is invalid");
  await expect(page.getByRole("button", { name: "Use credential" })).toBeEnabled();
  await credential.fill(granted);
  await page.getByRole("button", { name: "Use credential" }).click();
  await expect(page.getByText("Signed in as ada")).toBeVisible();
  await page.getByRole("combobox", { name: "Board" }).selectOption("restricted");
  await page.getByRole("textbox", { name: "Username" }).fill("Ada");
  await page.getByRole("textbox", { name: "Message" }).fill("Secret board post");
  await page.getByRole("button", { name: "Post message" }).click();
  await expect(page.getByRole("list", { name: "Messages" })).toContainText("Secret board post");
  await expect(page.getByRole("region", { name: "Board statistics" })).toContainText("1 messages");
  await expect(page.getByRole("region", { name: "Notifications" })).toContainText(
    "Secret board post",
  );
  await page.getByRole("combobox", { name: "Board" }).selectOption("announcements");
  await page.getByRole("textbox", { name: "Username" }).fill("Ada");
  await page.getByRole("textbox", { name: "Message" }).fill("Board update");
  await page.getByRole("button", { name: "Post message" }).click();
  await expect(page.getByRole("region", { name: "Announcements" })).toContainText("Board update");
  await expect(page.getByRole("region", { name: "Board statistics" })).toContainText("1 messages");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByText("Secret board post")).toHaveCount(0);
  await credential.fill(ordinary);
  await page.getByRole("button", { name: "Use credential" }).click();
  await expect(page.getByText("Signed in as reader")).toBeVisible();
  await page.getByRole("combobox", { name: "Board" }).selectOption("restricted");
  await expect(page.getByRole("region", { name: "Board statistics" })).toContainText(
    "No visible activity yet",
  );
  await expect(page.getByText("Secret board post")).toHaveCount(0);
});
