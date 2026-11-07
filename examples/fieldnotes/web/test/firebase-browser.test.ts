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

import { expect, it, vi } from "vitest";
import { FieldnotesFirebaseBrowser } from "../src/firebase-browser";

const sdk = vi.hoisted(() => ({
  initializeApp: vi.fn(() => ({ name: "fieldnotes-browser" })),
  deleteApp: vi.fn(() => Promise.resolve()),
  getAuth: vi.fn(() => ({ name: "auth" })),
  connectAuthEmulator: vi.fn(),
  setPersistence: vi.fn(() => Promise.resolve()),
  signInWithPopup: vi.fn(() => Promise.resolve({ user: { getIdToken: () => Promise.resolve("signed-token") } })),
  signOut: vi.fn(() => Promise.resolve()),
}));
vi.mock("firebase/app", () => ({ initializeApp: sdk.initializeApp, deleteApp: sdk.deleteApp }));
vi.mock("firebase/auth", () => ({
  getAuth: sdk.getAuth, connectAuthEmulator: sdk.connectAuthEmulator,
  inMemoryPersistence: { type: "NONE" }, setPersistence: sdk.setPersistence,
  GoogleAuthProvider: class { readonly provider = "google"; },
  signInWithPopup: sdk.signInWithPopup, signOut: sdk.signOut,
}));

it("obtains only a fresh Google ID token through a popup with ephemeral Firebase state", async () => {
  const browser = new FieldnotesFirebaseBrowser({
    apiKey: "public-key", authDomain: "demo-fieldnotes.firebaseapp.com",
    projectId: "demo-fieldnotes", emulatorUrl: "http://127.0.0.1:9099",
  });
  await expect(browser.googleToken()).resolves.toBe("signed-token");
  expect(sdk.setPersistence).toHaveBeenCalledOnce();
  expect(sdk.signInWithPopup).toHaveBeenCalledOnce();
  expect(sdk.connectAuthEmulator).toHaveBeenCalledWith(expect.anything(),
    "http://127.0.0.1:9099", { disableWarnings: true });
  await browser.close();
  expect(sdk.signOut).toHaveBeenCalledOnce();
  expect(sdk.deleteApp).toHaveBeenCalledOnce();
});

it("closes an SDK app after sign-out fails and leaves production auth off the emulator", async () => {
  sdk.connectAuthEmulator.mockClear();
  sdk.signOut.mockRejectedValueOnce(new Error("SDK sign-out unavailable"));
  const browser = new FieldnotesFirebaseBrowser({
    apiKey: "public-key", authDomain: "fieldnotes.firebaseapp.com", projectId: "fieldnotes",
  });
  await expect(browser.close()).resolves.toBeUndefined();
  expect(sdk.connectAuthEmulator).not.toHaveBeenCalled();
  expect(sdk.deleteApp).toHaveBeenCalledTimes(2);
});
