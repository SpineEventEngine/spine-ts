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

import { fireEvent, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { expect, test, vi } from "vitest";

import type { DesktopAuthStatus } from "../src/trusted/desktop-auth.js";

HTMLElement.prototype.scrollIntoView = vi.fn();

const choose = (label: string, option: string): void => {
  fireEvent.click(screen.getByRole("combobox", { name: label }));
  fireEvent.click(screen.getByRole("option", { name: option }));
};

const selectedValue = (label: string): string =>
  screen.getByRole("combobox", { name: label }).textContent.trim();

const hasOption = (label: string, option: string): boolean => {
  fireEvent.click(screen.getByRole("combobox", { name: label }));
  const found = screen.queryByRole("option", { name: option }) !== null;
  const listbox = screen.queryByRole("listbox");
  if (listbox) fireEvent.keyDown(listbox, { key: "Escape" });
  return found;
};

test("account switching ignores the prior catalog and distinguishes registrations", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  let resolveA: ((models: readonly { slug: string; displayName: string }[]) => void) | undefined;
  const catalogA = new Promise<readonly { slug: string; displayName: string }[]>((resolve) => {
    resolveA = resolve;
  });
  const staleCatalogSuccess =
    Promise.withResolvers<readonly { slug: string; displayName: string }[]>();
  const staleCatalogFailure =
    Promise.withResolvers<readonly { slug: string; displayName: string }[]>();
  const oldCurrentA = Promise.withResolvers<{ model: string }>();
  const oldCurrentB = Promise.withResolvers<{ model: string }>();
  let currentModelCalls = 0;
  const accounts = [
    { clientId: "client-A", subject: "same-subject", email: "same@example.com", planEnabled: true },
    { clientId: "client-B", subject: "same-subject", email: "same@example.com", planEnabled: true },
    { clientId: "client-C", subject: "subject-only", planEnabled: true },
  ];
  const status = (clientId: string): DesktopAuthStatus => ({
    selectedClientId: clientId,
    planEnabled: true,
    accounts,
    pendingClientIds: ["pending-client"],
  });
  let blockSignIn = false;
  let failCatalog = false;
  let failReconnect = false;
  let failSignOut = false;
  let failCurrentModel = false;
  let revocationConfirmed = false;
  let reconnected: string | undefined;
  const modelA = Promise.withResolvers<{ model: string }>();
  let releaseModelB: (() => void) | undefined;
  const modelB = new Promise<{ model: string }>((resolve) => {
    releaseModelB = () => {
      resolve({ model: "model-B" });
    };
  });
  let releaseB: ((models: readonly { slug: string; displayName: string }[]) => void) | undefined;
  const catalogB = new Promise<readonly { slug: string; displayName: string }[]>((resolve) => {
    releaseB = resolve;
  });
  let aCatalogCalls = 0;
  const bridge = {
    session: () => Promise.resolve({ drafts: [], generations: {} }),
    status: () => Promise.resolve(status("client-A")),
    signIn: () =>
      blockSignIn
        ? Promise.reject(
            new Error(
              "Error invoking remote method: Writing is still in progress. Wait, or quit and stop it.",
            ),
          )
        : Promise.resolve(status("client-A")),
    reconnect: (clientId: string) => {
      reconnected = clientId;
      return failReconnect
        ? Promise.reject(new Error("private refresh token details"))
        : Promise.resolve(status("client-A"));
    },
    selectAccount: (clientId: string) => Promise.resolve(status(clientId)),
    models: (clientId: string) => {
      if (clientId === "client-B")
        return failCatalog ? Promise.reject(new Error("provider-token-private")) : catalogB;
      aCatalogCalls += 1;
      if (aCatalogCalls === 1)
        return Promise.resolve([{ slug: "model-A", displayName: "Model A" }]);
      if (aCatalogCalls === 2) return catalogA;
      if (aCatalogCalls === 3) return staleCatalogSuccess.promise;
      if (aCatalogCalls === 4) return staleCatalogFailure.promise;
      return Promise.resolve([{ slug: "model-A", displayName: "Model A" }]);
    },
    selectModel: (_clientId: string, model: string) =>
      model === "model-A"
        ? modelA.promise
        : model === "model-B"
          ? modelB
          : Promise.resolve({ model }),
    currentModel: () => {
      currentModelCalls++;
      if (currentModelCalls === 1) return oldCurrentA.promise;
      if (currentModelCalls === 2) return oldCurrentB.promise;
      return failCurrentModel
        ? Promise.reject(new Error("private model lookup details"))
        : Promise.resolve({ model: "" });
    },
    signOut: () =>
      failSignOut
        ? Promise.reject(new Error("private revocation details"))
        : Promise.resolve({
            status: {
              accounts,
              pendingClientIds: ["pending-client"],
              planEnabled: false,
            },
            revocationConfirmed,
          }),
    manageUsage: () => Promise.resolve(),
  };
  Object.defineProperty(window, "releaseNotes", { configurable: true, value: bridge });
  document.body.innerHTML = '<div id="root"></div>';
  await act(async () => {
    await import("../src/renderer.js");
  });
  await screen.findByRole("combobox", { name: "Account" });
  expect(hasOption("Account", "same@example.com · 1")).toBe(true);
  expect(hasOption("Account", "ChatGPT account · 3")).toBe(true);
  await waitFor(() => {
    expect(hasOption("Model", "Model A")).toBe(true);
  });
  await waitFor(() => {
    expect(currentModelCalls).toBe(1);
  });
  choose("Model", "Model A");
  choose("Account", "same@example.com · 2");
  await waitFor(() => {
    expect(selectedValue("Account")).toContain("same@example.com · 2");
  });
  expect(hasOption("Model", "Model A")).toBe(false);
  await act(async () => {
    modelA.reject(new Error("private stale model selection"));
    oldCurrentA.reject(new Error("private stale account model"));
    await Promise.allSettled([modelA.promise, oldCurrentA.promise]);
  });
  expect(selectedValue("Model")).toContain("Select a model");
  expect(screen.queryByRole("status")).toBeNull();
  await act(async () => {
    releaseB?.([
      { slug: "model-B", displayName: "Model B" },
      { slug: "model-C", displayName: "Model C" },
    ]);
    await catalogB;
  });
  choose("Model", "Model B");
  choose("Model", "Model C");
  await waitFor(() => {
    expect(selectedValue("Model")).toContain("Model C");
  });
  await waitFor(() => {
    expect(currentModelCalls).toBe(2);
  });
  await act(async () => {
    oldCurrentB.resolve({ model: "model-B" });
    await oldCurrentB.promise;
  });
  expect(screen.queryByRole("status")).toBeNull();
  expect(selectedValue("Model")).toContain("Model C");
  await act(async () => {
    releaseModelB?.();
    await modelB;
  });
  expect(selectedValue("Model")).toContain("Model C");
  failCurrentModel = true;
  choose("Account", "same@example.com · 1");
  await waitFor(() => {
    expect(selectedValue("Account")).toContain("same@example.com · 1");
  });
  await act(async () => {
    resolveA?.([{ slug: "model-A", displayName: "Model A" }]);
    await catalogA;
  });
  expect(hasOption("Model", "Model A")).toBe(true);
  await waitFor(() => {
    expect(screen.getByRole("status").textContent).toBe("Selected model is unavailable.");
  });
  expect(screen.getByRole("status").textContent).not.toContain("private model lookup details");
  expect(hasOption("Account", "same@example.com · 1")).toBe(true);
  expect(hasOption("Account", "same@example.com · 2")).toBe(true);
  failCurrentModel = false;
  choose("Account", "same@example.com · 2");
  await waitFor(() => {
    expect(selectedValue("Account")).toContain("same@example.com · 2");
  });
  choose("Account", "same@example.com · 1");
  await waitFor(() => {
    expect(aCatalogCalls).toBe(3);
  });
  choose("Account", "same@example.com · 2");
  await waitFor(() => {
    expect(selectedValue("Account")).toContain("same@example.com · 2");
  });
  await act(async () => {
    staleCatalogSuccess.resolve([{ slug: "model-A", displayName: "Model A" }]);
    await staleCatalogSuccess.promise;
  });
  expect(hasOption("Model", "Model A")).toBe(false);
  choose("Account", "same@example.com · 1");
  await waitFor(() => {
    expect(aCatalogCalls).toBe(4);
  });
  choose("Account", "same@example.com · 2");
  await waitFor(() => {
    expect(selectedValue("Account")).toContain("same@example.com · 2");
  });
  await act(async () => {
    staleCatalogFailure.reject(new Error("private old account catalog"));
    await Promise.allSettled([staleCatalogFailure.promise]);
  });
  expect(screen.queryByRole("status")).toBeNull();
  expect(hasOption("Model", "Model B")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Continue sign-in 1" }));
  await waitFor(() => {
    expect(reconnected).toBe("pending-client");
  });
  await waitFor(() => {
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Continue with ChatGPT" }).disabled,
    ).toBe(false);
  });
  blockSignIn = true;
  fireEvent.click(screen.getByRole("button", { name: "Continue with ChatGPT" }));
  await waitFor(() => {
    expect(screen.getByRole("status").textContent).toBe(
      "Writing is still in progress. Wait, or quit and stop it.",
    );
  });
  failCatalog = true;
  choose("Account", "same@example.com · 2");
  await waitFor(() => {
    expect(screen.getByRole("status").textContent).toBe("Models for this account are unavailable.");
  });
  expect(screen.getByRole("status").textContent).not.toContain("provider-token-private");
  failReconnect = true;
  fireEvent.click(screen.getByRole("button", { name: "Refresh connection" }));
  await waitFor(() => {
    expect(screen.getByRole("status").textContent).toBe(
      "The account action could not be completed.",
    );
  });
  expect(screen.getByRole("status").textContent).not.toContain("private refresh token details");
  failSignOut = true;
  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
  await waitFor(() => {
    expect(screen.getByRole("status").textContent).toBe("Sign-out could not be completed.");
  });
  expect(screen.getByRole("status").textContent).not.toContain("private revocation details");
  failSignOut = false;
  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
  await waitFor(() => {
    expect(screen.getByRole("status").textContent).toBe(
      "Signed out on this computer. We could not confirm that OpenAI removed the connection.",
    );
  });
  failReconnect = false;
  fireEvent.click(screen.getByRole("button", { name: "Continue sign-in 1" }));
  await waitFor(() => {
    expect(selectedValue("Account")).toContain("same@example.com · 1");
  });
  revocationConfirmed = true;
  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
  await waitFor(() => {
    expect(screen.queryByRole("status")).toBeNull();
  });
});
