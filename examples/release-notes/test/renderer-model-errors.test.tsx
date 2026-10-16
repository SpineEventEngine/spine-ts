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

// @vitest-environment jsdom
import { mountRenderer } from "./renderer-root.js";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";

HTMLElement.prototype.scrollIntoView = vi.fn();

test("catalog failure keeps the workspace visible and uncertain sign-out explains local clearance", async () => {
  const signedIn = {
    accounts: [{ clientId: "client", email: "person@example.invalid", planEnabled: true }],
    selectedClientId: "client",
    planEnabled: true,
    pendingClientIds: [],
  };
  const signedOut = { accounts: [], planEnabled: false, pendingClientIds: [] };
  let catalogAvailable = false;
  const signOut = vi.fn(() => Promise.resolve({ status: signedOut, revocationConfirmed: false }));
  Object.defineProperty(window, "releaseNotes", {
    configurable: true,
    value: {
      status: () => Promise.resolve(signedIn),
      signIn: () => {
        catalogAvailable = true;
        return Promise.resolve(signedIn);
      },
      models: () =>
        catalogAvailable
          ? Promise.resolve([{ slug: "demo", displayName: "Demo model" }])
          : Promise.reject(new Error("private catalog response")),
      currentModel: () => Promise.reject(new Error("private selected model")),
      session: () => Promise.resolve({ drafts: [], generations: {} }),
      signOut,
    },
  });
  document.body.innerHTML = '<div id="root"></div>';
  await act(async () => {
    await mountRenderer();
  });
  await screen.findByRole("heading", { name: "Your releases" });
  await screen.findByText("Models for this account are unavailable.");
  expect(screen.queryByText("private catalog response")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
  await waitFor(() => {
    expect(signOut).toHaveBeenCalledWith("client");
  });
  await screen.findByRole("dialog", { name: "Welcome" });
  expect(
    screen.getByText(
      "Signed out on this computer. We could not confirm that OpenAI removed the connection.",
    ),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Sign in with ChatGPT" }));
  await screen.findByRole("heading", { name: "Your releases" });
  await screen.findByText("Selected model is unavailable.");
  expect(screen.queryByText("private selected model")).toBeNull();
  signOut.mockRejectedValueOnce(new Error("private remote failure"));
  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
  await screen.findByText("Could not sign out yet.");
  expect(screen.getByRole("heading", { name: "Your releases" })).toBeTruthy();
});
