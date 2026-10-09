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
  const accounts = [
    { clientId: "client-A", subject: "same-subject", email: "same@example.com", planEnabled: true },
    { clientId: "client-B", subject: "same-subject", email: "same@example.com", planEnabled: true },
  ];
  const status = (clientId: string): DesktopAuthStatus => ({
    selectedClientId: clientId,
    planEnabled: true,
    accounts,
    pendingClientIds: ["pending-client"],
  });
  let reconnected: string | undefined;
  let releaseModelA: (() => void) | undefined;
  const modelA = new Promise<{ model: string }>((resolve) => {
    releaseModelA = () => {
      resolve({ model: "model-A" });
    };
  });
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
    status: () => Promise.resolve(status("client-A")),
    signIn: () => Promise.resolve(status("client-A")),
    reconnect: (clientId: string) => {
      reconnected = clientId;
      return Promise.resolve(status("client-A"));
    },
    selectAccount: (clientId: string) => Promise.resolve(status(clientId)),
    models: (clientId: string) => {
      if (clientId === "client-B") return catalogB;
      aCatalogCalls += 1;
      return aCatalogCalls === 1
        ? Promise.resolve([{ slug: "model-A", displayName: "Model A" }])
        : catalogA;
    },
    selectModel: (_clientId: string, model: string) =>
      model === "model-A" ? modelA : model === "model-B" ? modelB : Promise.resolve({ model }),
    signOut: () => Promise.resolve({ status: status("client-A"), revocationConfirmed: true }),
    manageUsage: () => Promise.resolve(),
  };
  Object.defineProperty(window, "releaseNotes", { configurable: true, value: bridge });
  document.body.innerHTML = '<div id="root"></div>';
  await import("../src/renderer.js");
  await screen.findByRole("option", { name: "same@example.com (client-A)" });
  await screen.findByRole("option", { name: "Model A" });
  fireEvent.change(screen.getByLabelText("Available to this account"), {
    target: { value: "model-A" },
  });
  fireEvent.change(screen.getByLabelText("Account"), { target: { value: "client-B" } });
  await waitFor(() => {
    expect(selectedValue("Account")).toBe("client-B");
  });
  expect(screen.queryByRole("option", { name: "Model A" })).toBeNull();
  await act(async () => {
    releaseModelA?.();
    await modelA;
  });
  expect(selectedValue("Available to this account")).toBe("");
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
  await act(async () => {
    releaseModelB?.();
    await modelB;
  });
  expect(selectedValue("Available to this account")).toBe("model-C");
  fireEvent.change(screen.getByLabelText("Account"), { target: { value: "client-A" } });
  await waitFor(() => {
    expect(selectedValue("Account")).toBe("client-A");
  });
  await act(async () => {
    resolveA?.([{ slug: "model-A", displayName: "Model A" }]);
    await catalogA;
  });
  expect(screen.getByRole("option", { name: "Model A" })).toBeTruthy();
  expect(screen.getByRole("option", { name: "same@example.com (client-A)" })).toBeTruthy();
  expect(screen.getByRole("option", { name: "same@example.com (client-B)" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Retry pending-client" }));
  await waitFor(() => {
    expect(reconnected).toBe("pending-client");
  });
});
