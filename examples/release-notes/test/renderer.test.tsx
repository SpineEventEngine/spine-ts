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
import { expect, test } from "vitest";

import type { DesktopAuthStatus } from "../src/trusted/desktop-auth.js";

const selectedValue = (label: string): string => {
  const element = screen.getByLabelText(label);
  if (!(element instanceof HTMLSelectElement)) throw new Error(`${label} is not a select element.`);
  return element.value;
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
              "Error invoking remote method: Wait for the active generation or stop and quit.",
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
  await screen.findByRole("option", { name: "same@example.com (client-A)" });
  expect(screen.getByRole("option", { name: "subject-only (client-C)" })).toBeTruthy();
  await screen.findByRole("option", { name: "Model A" });
  await waitFor(() => {
    expect(currentModelCalls).toBe(1);
  });
  fireEvent.change(screen.getByLabelText("Available to this account"), {
    target: { value: "model-A" },
  });
  fireEvent.change(screen.getByLabelText("Account"), { target: { value: "client-B" } });
  await waitFor(() => {
    expect(selectedValue("Account")).toBe("client-B");
  });
  expect(screen.queryByRole("option", { name: "Model A" })).toBeNull();
  await act(async () => {
    modelA.reject(new Error("private stale model selection"));
    oldCurrentA.reject(new Error("private stale account model"));
    await Promise.allSettled([modelA.promise, oldCurrentA.promise]);
  });
  expect(selectedValue("Available to this account")).toBe("");
  expect(screen.queryByRole("status")).toBeNull();
  await act(async () => {
    releaseB?.([
      { slug: "model-B", displayName: "Model B" },
      { slug: "model-C", displayName: "Model C" },
    ]);
    await catalogB;
  });
  fireEvent.change(screen.getByLabelText("Available to this account"), {
    target: { value: "model-B" },
  });
  fireEvent.change(screen.getByLabelText("Available to this account"), {
    target: { value: "model-C" },
  });
  await waitFor(() => {
    expect(selectedValue("Available to this account")).toBe("model-C");
  });
  await waitFor(() => {
    expect(currentModelCalls).toBe(2);
  });
  await act(async () => {
    oldCurrentB.resolve({ model: "model-B" });
    await oldCurrentB.promise;
  });
  expect(screen.queryByRole("status")).toBeNull();
  expect(selectedValue("Available to this account")).toBe("model-C");
  await act(async () => {
    releaseModelB?.();
    await modelB;
  });
  expect(selectedValue("Available to this account")).toBe("model-C");
  failCurrentModel = true;
  fireEvent.change(screen.getByLabelText("Account"), { target: { value: "client-A" } });
  await waitFor(() => {
    expect(selectedValue("Account")).toBe("client-A");
  });
  await act(async () => {
    resolveA?.([{ slug: "model-A", displayName: "Model A" }]);
    await catalogA;
  });
  expect(screen.getByRole("option", { name: "Model A" })).toBeTruthy();
  await waitFor(() => {
    expect(screen.getByRole("status").textContent).toBe("Selected model is unavailable.");
  });
  expect(screen.getByRole("status").textContent).not.toContain("private model lookup details");
  expect(screen.getByRole("option", { name: "same@example.com (client-A)" })).toBeTruthy();
  expect(screen.getByRole("option", { name: "same@example.com (client-B)" })).toBeTruthy();
  failCurrentModel = false;
  fireEvent.change(screen.getByLabelText("Account"), { target: { value: "client-B" } });
  await waitFor(() => {
    expect(selectedValue("Account")).toBe("client-B");
  });
  fireEvent.change(screen.getByLabelText("Account"), { target: { value: "client-A" } });
  await waitFor(() => {
    expect(aCatalogCalls).toBe(3);
  });
  fireEvent.change(screen.getByLabelText("Account"), { target: { value: "client-B" } });
  await waitFor(() => {
    expect(selectedValue("Account")).toBe("client-B");
  });
  await act(async () => {
    staleCatalogSuccess.resolve([{ slug: "model-A", displayName: "Model A" }]);
    await staleCatalogSuccess.promise;
  });
  expect(screen.queryByRole("option", { name: "Model A" })).toBeNull();
  fireEvent.change(screen.getByLabelText("Account"), { target: { value: "client-A" } });
  await waitFor(() => {
    expect(aCatalogCalls).toBe(4);
  });
  fireEvent.change(screen.getByLabelText("Account"), { target: { value: "client-B" } });
  await waitFor(() => {
    expect(selectedValue("Account")).toBe("client-B");
  });
  await act(async () => {
    staleCatalogFailure.reject(new Error("private old account catalog"));
    await Promise.allSettled([staleCatalogFailure.promise]);
  });
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.getByRole("option", { name: "Model B" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Retry pending-client" }));
  await waitFor(() => {
    expect(reconnected).toBe("pending-client");
  });
  blockSignIn = true;
  fireEvent.click(screen.getByRole("button", { name: "Continue with ChatGPT" }));
  await waitFor(() => {
    expect(screen.getByRole("status").textContent).toBe(
      "Wait for the active generation or stop and quit.",
    );
  });
  failCatalog = true;
  fireEvent.change(screen.getByLabelText("Account"), { target: { value: "client-B" } });
  await waitFor(() => {
    expect(screen.getByRole("status").textContent).toBe("Models for this account are unavailable.");
  });
  expect(screen.getByRole("status").textContent).not.toContain("provider-token-private");
  failReconnect = true;
  fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
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
      "Signed out locally; remote revocation was not confirmed.",
    );
  });
  failReconnect = false;
  fireEvent.click(screen.getByRole("button", { name: "Retry pending-client" }));
  await waitFor(() => {
    expect(selectedValue("Account")).toBe("client-A");
  });
  revocationConfirmed = true;
  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
  await waitFor(() => {
    expect(screen.queryByRole("status")).toBeNull();
  });
});
