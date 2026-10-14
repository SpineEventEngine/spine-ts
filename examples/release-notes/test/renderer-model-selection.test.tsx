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

HTMLElement.prototype.hasPointerCapture = () => false;
HTMLElement.prototype.setPointerCapture = () => undefined;
HTMLElement.prototype.releasePointerCapture = () => undefined;
HTMLElement.prototype.scrollIntoView = () => undefined;

const choose = async (label: string, value: string) => {
  fireEvent.pointerDown(screen.getByRole("combobox", { name: label }), {
    button: 0,
    ctrlKey: false,
    pointerType: "mouse",
    pointerId: 1,
  });
  fireEvent.click(await screen.findByRole("option", { name: value }));
};

const selectedModel = () => screen.getByRole("combobox", { name: "Model" }).textContent;
const write = () => screen.getByRole<HTMLButtonElement>("button", { name: /Write/ });

const deferred = <T,>() => Promise.withResolvers<T>();

test("a clicked model displays immediately and only the latest confirmed choice becomes ready", async () => {
  const first = deferred<{ model: string }>();
  const second = deferred<{ model: string }>();
  const failed = deferred<{ model: string }>();
  const retry = deferred<{ model: string }>();
  const afterSignOut = deferred<{ model: string }>();
  const hydration = deferred<{ model: string }>();
  const selections = [first, second, failed, retry, afterSignOut];
  let activeSelection = false;
  const selectModel = vi.fn((clientId: string, model: string) => {
    if (clientId !== "client" || !["model-a", "model-b", "model-c"].includes(model))
      throw new Error("Unexpected model registration.");
    if (activeSelection) return Promise.reject(new Error("Overlapping model registration"));
    const selection = selections.shift();
    if (!selection) throw new Error("No selection response was prepared.");
    activeSelection = true;
    return selection.promise.finally(() => {
      activeSelection = false;
    });
  });
  const signedOut = { accounts: [], planEnabled: false, pendingClientIds: [] };
  Object.defineProperty(window, "releaseNotes", {
    configurable: true,
    value: {
      status: () =>
        Promise.resolve({
          accounts: [{ clientId: "client", subject: "subject", planEnabled: true }],
          selectedClientId: "client",
          planEnabled: true,
          pendingClientIds: [],
        }),
      models: () =>
        Promise.resolve([
          { slug: "model-a", displayName: "Model A" },
          { slug: "model-b", displayName: "Model B" },
          { slug: "model-c", displayName: "Model C" },
        ]),
      currentModel: () => hydration.promise,
      selectModel,
      session: () => Promise.resolve({ drafts: [], generations: {} }),
      chooseProject: () =>
        Promise.resolve({ handle: "handle", name: "portal", refs: ["v1", "main"] }),
      compareProject: () =>
        Promise.resolve({
          selectionId: "selection",
          projectName: "portal",
          baseLabel: "v1",
          targetLabel: "main",
          commits: [{}],
          changes: [{}],
        }),
      signOut: () => Promise.resolve({ status: signedOut, revocationConfirmed: true }),
    },
  });
  document.body.innerHTML = '<div id="root"></div>';
  await act(async () => {
    await mountRenderer();
  });
  fireEvent.click(await screen.findByRole("button", { name: "New release" }));
  fireEvent.click(screen.getByRole("button", { name: "Choose a Git project" }));
  await screen.findByText("portal");
  await choose("From", "v1");
  await choose("To", "main");
  fireEvent.change(screen.getByLabelText("Release"), { target: { value: "Portal 2.4" } });
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await screen.findByText("1 commit · 1 file");
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await screen.findByRole("heading", { name: "Writing style" });
  expect(write().disabled).toBe(true);
  await choose("Model", "Model A");
  expect(selectedModel()).toContain("Model A");
  expect(screen.getByText("Preparing model…")).toBeTruthy();
  expect(write().disabled).toBe(true);
  await choose("Model", "Model B");
  expect(selectedModel()).toContain("Model B");
  await choose("Model", "Model C");
  expect(selectedModel()).toContain("Model C");
  expect(selectModel).toHaveBeenCalledTimes(1);
  await act(async () => {
    hydration.resolve({ model: "model-a" });
    await hydration.promise;
  });
  expect(selectedModel()).toContain("Model C");
  await act(async () => {
    first.resolve({ model: "model-a" });
    await first.promise;
  });
  expect(selectedModel()).toContain("Model C");
  expect(screen.getByText("Preparing model…")).toBeTruthy();
  expect(write().disabled).toBe(true);
  await act(async () => {
    second.resolve({ model: "model-c" });
    await second.promise;
  });
  await waitFor(() => {
    expect(screen.queryByText("Preparing model…")).toBeNull();
  });
  expect(selectModel.mock.calls.map((call) => call[1])).toEqual(["model-a", "model-c"]);
  await choose("Model", "Model A");
  expect(screen.getByText("Preparing model…")).toBeTruthy();
  expect(write().disabled).toBe(true);
  await act(async () => {
    failed.reject(new Error("Unavailable"));
    await failed.promise.catch(() => undefined);
  });
  expect(selectedModel()).toContain("Select a model");
  expect(write().disabled).toBe(true);
  expect(screen.getByText("That model is no longer available to this account.")).toBeTruthy();
  await choose("Model", "Model A");
  expect(selectedModel()).toContain("Model A");
  expect(screen.queryByText("That model is no longer available to this account.")).toBeNull();
  await act(async () => {
    retry.resolve({ model: "model-a" });
    await retry.promise;
  });
  expect(screen.queryByText("Preparing model…")).toBeNull();
  expect(write().disabled).toBe(false);
  await choose("Model", "Model B");
  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
  await screen.findByRole("dialog", { name: "Welcome" });
  await act(async () => {
    afterSignOut.resolve({ model: "model-b" });
    await afterSignOut.promise;
  });
  expect(screen.queryByRole("combobox", { name: "Model" })).toBeNull();
  expect(selectModel).toHaveBeenCalledTimes(5);
});
