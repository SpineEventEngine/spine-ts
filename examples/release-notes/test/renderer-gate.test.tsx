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
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";

HTMLElement.prototype.scrollIntoView = vi.fn();

test("keeps the workspace behind sign-in until a usable account is confirmed", async () => {
  const status = Promise.withResolvers<{
    accounts: readonly { clientId: string; email: string; planEnabled: boolean }[];
    planEnabled: boolean;
    pendingClientIds: readonly string[];
    selectedClientId?: string;
  }>();
  const signedOut = { accounts: [], planEnabled: false, pendingClientIds: [] };
  const signedIn = {
    accounts: [{ clientId: "client", email: "user@example.invalid", planEnabled: true }],
    planEnabled: true,
    pendingClientIds: [],
    selectedClientId: "client",
  };
  const pending = {
    accounts: [{ clientId: "client", email: "user@example.invalid", planEnabled: false }],
    planEnabled: false,
    pendingClientIds: ["client"],
  };
  const statusRead = vi
    .fn()
    .mockImplementationOnce(() => status.promise)
    .mockResolvedValue(signedOut);
  const signInAction = vi
    .fn()
    .mockRejectedValueOnce(new Error("Sign-in cancelled"))
    .mockResolvedValueOnce(pending)
    .mockResolvedValue(signedIn);
  const bridge = {
    status: statusRead,
    signIn: signInAction,
    reconnect: () => Promise.resolve(signedIn),
    signOut: () => Promise.resolve({ status: signedOut, revocationConfirmed: true }),
    models: () => Promise.resolve([{ slug: "gpt-release", displayName: "Release model" }]),
    currentModel: () => Promise.resolve({ model: "gpt-release" }),
    session: () => Promise.resolve({ drafts: [], generations: {} }),
  };
  Object.defineProperty(window, "releaseNotes", { configurable: true, value: bridge });
  document.body.innerHTML = '<div id="root"></div>';
  await act(async () => {
    await import("../src/renderer.js");
  });
  expect(screen.getByRole("dialog", { name: "Welcome" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "New release" })).toBeNull();
  await act(async () => {
    status.reject(new Error("Connection check failed"));
    await status.promise.catch(() => undefined);
  });
  expect(screen.getByText("Could not check your ChatGPT connection.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Check connection again" }));
  await waitFor(() => {
    expect(statusRead).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "Sign in with ChatGPT" })).toBeTruthy();
  });
  const signIn = screen.getByRole("button", { name: "Sign in with ChatGPT" });
  signIn.focus();
  fireEvent.keyDown(signIn, { key: "Escape" });
  expect(screen.getByRole("dialog", { name: "Welcome" })).toBeTruthy();
  fireEvent.keyDown(signIn, { key: "Tab" });
  expect(document.activeElement).toBe(signIn);
  expect(screen.queryByRole("button", { name: "Quit" })).toBeNull();
  fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Tab" });
  expect(document.activeElement).toBe(signIn);
  fireEvent.click(signIn);
  await screen.findByText("The account action could not be completed.");
  expect(screen.queryByRole("button", { name: "New release" })).toBeNull();
  fireEvent.click(signIn);
  await waitFor(() => {
    expect(signInAction).toHaveBeenCalledTimes(2);
  });
  expect(screen.queryByRole("button", { name: /Continue sign-in \d/ })).toBeNull();
  expect(screen.queryByRole("button", { name: "Check connection again" })).toBeNull();
  expect(screen.getByRole("combobox", { name: "Account" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Continue sign-in" }));
  await waitFor(() => {
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "New release" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Your releases" })).toBeTruthy();
  });
  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
  await waitFor(() => {
    expect(screen.getByRole("dialog", { name: "Welcome" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "New release" })).toBeNull();
  });
  fireEvent.click(screen.getByRole("button", { name: "Sign in with ChatGPT" }));
  await waitFor(() => {
    expect(screen.getByRole("heading", { name: "Your releases" })).toBeTruthy();
  });
});
