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

test("a limited grant can retry sign-in in the same app session without saved-account controls", async () => {
  const noPlan = {
    accounts: [{ clientId: "limited", email: "limited@example.invalid", planEnabled: false }],
    planEnabled: false,
    pendingClientIds: [],
    selectedClientId: "limited",
  };
  const pending = {
    accounts: noPlan.accounts,
    planEnabled: false,
    pendingClientIds: ["issued"],
  };
  const eligible = {
    accounts: [
      ...noPlan.accounts,
      { clientId: "eligible", email: "eligible@example.invalid", planEnabled: true },
    ],
    planEnabled: true,
    pendingClientIds: [],
    selectedClientId: "eligible",
  };
  const signIn = vi.fn().mockResolvedValueOnce(pending).mockResolvedValueOnce(eligible);
  Object.defineProperty(window, "releaseNotes", {
    configurable: true,
    value: {
      status: () => Promise.resolve(noPlan),
      signIn,
      session: () => Promise.resolve({ drafts: [], generations: {} }),
      models: () => Promise.resolve([{ slug: "demo", displayName: "Demo model" }]),
      currentModel: () => Promise.resolve({ model: "demo" }),
    },
  });
  document.body.innerHTML = '<div id="root"></div>';
  await act(async () => {
    await mountRenderer();
  });
  const primary = await screen.findByRole("button", { name: "Sign in with ChatGPT" });
  expect(screen.queryByRole("combobox", { name: "Account" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Use another account" })).toBeNull();
  fireEvent.click(primary);
  await waitFor(() => {
    expect(signIn).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Continue sign-in" })).toBeTruthy();
  });
  fireEvent.click(screen.getByRole("button", { name: "Continue sign-in" }));
  await waitFor(() => {
    expect(signIn).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "New release" })).toBeTruthy();
  });
});
