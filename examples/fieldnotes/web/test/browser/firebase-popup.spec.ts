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

import { randomUUID } from "node:crypto";
import { deleteApp, initializeApp } from "firebase/app";
import {
  connectAuthEmulator,
  getAuth,
  GoogleAuthProvider,
  signInWithCredential,
  signOut,
} from "firebase/auth";
import { expect, test } from "@playwright/test";

test.afterEach(async () => {
  const response = await fetch("http://127.0.0.1:45110/test/shutdown", { method: "POST" });
  expect(response.status).toBe(204);
});

test("Firebase browser SDK popup exchanges an emulator Google identity for the private workspace", async ({
  page,
}, testInfo) => {
  const identity = randomUUID();
  const email = `fieldnotes-${identity}@example.test`;
  const fixtureApp = initializeApp(
    {
      apiKey: "demo-fieldnotes-key",
      authDomain: "demo-fieldnotes.firebaseapp.com",
      projectId: "demo-fieldnotes",
    },
    `fieldnotes-popup-${identity}`,
  );
  const fixtureAuth = getAuth(fixtureApp);
  connectAuthEmulator(fixtureAuth, "http://127.0.0.1:9099", { disableWarnings: true });
  try {
    await signInWithCredential(
      fixtureAuth,
      GoogleAuthProvider.credential(
        JSON.stringify({
          sub: `local-google-${identity}`,
          email,
        }),
      ),
    );
  } finally {
    await signOut(fixtureAuth);
    await deleteApp(fixtureApp);
  }
  await page.goto("/");
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Continue with Google" }).click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL(/127\.0\.0\.1:9099\/emulator\/auth\/handler/);
  await expect(popup.locator("body")).toBeVisible();
  await popup.screenshot({ path: testInfo.outputPath("firebase-popup.png") });
  await popup.getByText(email, { exact: true }).click();
  await expect(page.getByRole("heading", { name: "Saved places" })).toBeVisible();
  await page.getByRole("button", { name: "Add a place" }).first().click();
  await page.getByLabel("Place name").fill("Firebase place");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Firebase place" })).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Firebase place" })).toHaveCount(0);
});
