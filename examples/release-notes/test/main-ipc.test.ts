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

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => {
  const appEvents = new Map<string, (...args: unknown[]) => void>();
  const contentEvents = new Map<string, (...args: unknown[]) => void>();
  const session = { setPermissionRequestHandler: vi.fn() };
  const webContents = {
    id: 17,
    session,
    on: vi.fn((name: string, callback: (...args: unknown[]) => void) => {
      contentEvents.set(name, callback);
    }),
    setWindowOpenHandler: vi.fn(),
  };
  const window = { webContents, loadFile: vi.fn().mockResolvedValue(undefined), focus: vi.fn() };
  const app = {
    requestSingleInstanceLock: vi.fn(() => true),
    setName: vi.fn(),
    getPath: vi.fn(() => "/tmp"),
    on: vi.fn((name: string, callback: (...args: unknown[]) => void) => {
      appEvents.set(name, callback);
    }),
    whenReady: vi.fn(() => Promise.resolve()),
    quit: vi.fn(),
  };
  const ipc = { handle: vi.fn() };
  const closeInstall = vi.fn();
  const showMessageBox = vi.fn();
  const openExternal = vi.fn().mockResolvedValue(undefined);
  let openAuthUrl: ((url: string) => Promise<void>) | undefined;
  const auth = {
    status: vi.fn().mockResolvedValue({ accounts: [], planEnabled: false }),
    signIn: vi.fn().mockResolvedValue({ signedIn: true }),
    selectAccount: vi.fn().mockResolvedValue({ selected: true }),
    models: vi.fn().mockResolvedValue([{ slug: "account-model" }]),
    signOut: vi.fn().mockResolvedValue({ revoked: true }),
  };
  const plan = { activeBinding: vi.fn().mockResolvedValue(undefined), selectDiscovered: vi.fn() };
  const studio = {
    session: vi.fn(() => ({ drafts: [], generations: {} })),
    history: vi.fn().mockResolvedValue({ items: [] }),
    requestGeneration: vi.fn().mockResolvedValue("generation"),
    repeatGeneration: vi.fn().mockResolvedValue("generation"),
    generationObservation: vi.fn().mockResolvedValue({ receipt: true, phase: "active" }),
    evidencePatch: vi.fn().mockResolvedValue({ complete: true, patch: "approved diff" }),
    withAccountTransition: vi.fn((action: () => Promise<unknown>) => action()),
    selectionLocked: vi.fn().mockResolvedValue(false),
    allowsReconnect: vi.fn().mockResolvedValue(false),
    close: vi.fn(),
  };
  return {
    appEvents,
    contentEvents,
    app,
    ipc,
    auth,
    plan,
    studio,
    webContents,
    window,
    closeInstall,
    showMessageBox,
    openExternal,
    get openAuthUrl() {
      return openAuthUrl;
    },
    set openAuthUrl(value: ((url: string) => Promise<void>) | undefined) {
      openAuthUrl = value;
    },
  };
});

vi.mock("electron", () => ({
  app: fixture.app,
  ipcMain: fixture.ipc,
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString(),
  },
  shell: { openExternal: fixture.openExternal },
  dialog: { showMessageBox: fixture.showMessageBox },
  BrowserWindow: Object.assign(
    function BrowserWindow() {
      return fixture.window;
    },
    {
      getAllWindows: () => [fixture.window],
    },
  ),
}));
vi.mock("../src/trusted/desktop-auth.js", () => ({
  DesktopAuth: function DesktopAuth(
    _session: unknown,
    _store: unknown,
    openAuthUrl: (url: string) => Promise<void>,
  ) {
    fixture.openAuthUrl = openAuthUrl;
    return fixture.auth;
  },
}));
vi.mock("../src/trusted/siwc-session.js", () => ({
  SiwcSession: function SiwcSession() {
    return {};
  },
}));
vi.mock("../src/trusted/credential-store.js", () => ({
  CredentialStore: function CredentialStore() {
    return {};
  },
}));
vi.mock("../src/trusted/plan-model-selection.js", () => ({
  PlanModelSelection: function PlanModelSelection() {
    return fixture.plan;
  },
}));
vi.mock("../src/trusted/studio-service.js", () => ({
  ReleaseStudio: { start: () => Promise.resolve(fixture.studio) },
}));
vi.mock("../src/trusted/studio-window-close.js", () => ({
  StudioWindowClose: { install: fixture.closeInstall },
}));

it("registers one validated IPC boundary and rejects forged frames before application actions", async () => {
  await import("../src/main.js");
  await vi.waitFor(() => {
    expect(fixture.ipc.handle).toHaveBeenCalledOnce();
  });
  const handler = fixture.ipc.handle.mock.calls[0]?.[1] as (
    event: unknown,
    command: unknown,
    input: unknown,
  ) => Promise<unknown>;
  const expectedFrame = pathToFileURL(resolve("examples/release-notes/renderer.html")).href;
  const event = { sender: { id: 17 }, senderFrame: { url: expectedFrame } };
  await expect(handler(event, "status", null)).resolves.toEqual({
    accounts: [],
    planEnabled: false,
  });
  await expect(handler(event, "session", null)).resolves.toEqual({ drafts: [], generations: {} });
  const id = "12345678-1234-1234-1234-123456789abc";
  await expect(
    handler(event, "history", { id, category: "domain", pageSize: 20, cursor: "older" }),
  ).resolves.toEqual({ items: [] });
  expect(fixture.studio.history).toHaveBeenCalledWith(id, "domain", 20, "older");
  await expect(handler(event, "generate", { id, instruction: "Summarize" })).resolves.toEqual({
    generation: "generation",
  });
  await expect(handler(event, "repeat-generation", { generation: id })).resolves.toEqual({
    generation: "generation",
  });
  await expect(handler(event, "phase", { generation: id })).resolves.toEqual({
    receipt: true,
    phase: "active",
  });
  await expect(handler(event, "evidence-patch", { selectionId: id, index: 2 })).resolves.toEqual({
    complete: true,
    patch: "approved diff",
  });
  await expect(handler(event, "current-model", null)).resolves.toEqual({ model: "" });
  await expect(
    handler(event, "select-model", { clientId: "issued-client", model: "account-model" }),
  ).resolves.toEqual({ model: "account-model" });
  expect(fixture.plan.selectDiscovered).toHaveBeenCalledWith("issued-client", "account-model");
  await expect(handler(event, "sign-in", null)).resolves.toEqual({ signedIn: true });
  await expect(handler(event, "reconnect", "issued-client")).resolves.toEqual({ signedIn: true });
  expect(fixture.auth.signIn).toHaveBeenLastCalledWith("issued-client");
  await expect(handler(event, "select-account", "issued-client")).resolves.toEqual({
    selected: true,
  });
  await expect(handler(event, "models", "issued-client")).resolves.toEqual([
    { slug: "account-model" },
  ]);
  await expect(handler(event, "sign-out", "issued-client")).resolves.toEqual({ revoked: true });
  await expect(handler(event, "usage", null)).resolves.toBeNull();
  expect(fixture.openExternal).toHaveBeenCalledWith("https://chatgpt.com/#settings/usage");
  await expect(handler(event, "history", { id, category: "other", pageSize: 20 })).rejects.toThrow(
    "History is unavailable",
  );
  await expect(
    handler({ ...event, senderFrame: { url: "https://attacker.invalid" } }, "status", null),
  ).rejects.toThrow("The requested action could not be confirmed");
  await expect(handler({ ...event, sender: { id: 99 } }, "session", null)).rejects.toThrow(
    "The requested action could not be confirmed",
  );
  await expect(handler({ ...event, senderFrame: undefined }, "status", null)).rejects.toThrow(
    "The requested action could not be confirmed",
  );
  await expect(handler(event, 7, null)).rejects.toThrow(
    "The requested action could not be confirmed",
  );
  await expect(handler(event, "select-model", null)).rejects.toThrow(
    "The requested action could not be confirmed",
  );
  await expect(handler(event, "run-shell", { executable: "/bin/sh" })).rejects.toThrow(
    "The requested action could not be confirmed",
  );
  expect(fixture.auth.status).toHaveBeenCalledOnce();
  expect(fixture.studio.session).toHaveBeenCalledOnce();
  expect(fixture.auth.status).toHaveBeenCalledOnce();
});

it("opens only the intended authorization origin outside the renderer", async () => {
  const prior = fixture.openExternal.mock.calls.length;
  await expect(fixture.openAuthUrl?.("https://attacker.invalid/authorize")).rejects.toThrow();
  expect(fixture.openExternal).toHaveBeenCalledTimes(prior);
  await fixture.openAuthUrl?.("https://auth.openai.com/oauth/authorize");
  expect(fixture.openExternal).toHaveBeenLastCalledWith("https://auth.openai.com/oauth/authorize");
});

it("blocks navigation, popups, permissions, and webviews while retaining the singleton window", () => {
  const popup = fixture.webContents.setWindowOpenHandler.mock.calls[0]?.[0] as () => unknown;
  expect(popup()).toEqual({ action: "deny" });
  const permission = fixture.webContents.session.setPermissionRequestHandler.mock.calls[0]?.[0] as (
    _contents: unknown,
    _name: string,
    answer: (allowed: boolean) => void,
  ) => void;
  const respond = vi.fn();
  permission(null, "camera", respond);
  expect(respond).toHaveBeenCalledWith(false);
  const preventDefault = vi.fn();
  fixture.contentEvents.get("will-navigate")?.({ preventDefault }, "https://attacker.invalid");
  expect(preventDefault).toHaveBeenCalledOnce();
  fixture.contentEvents.get("will-navigate")?.(
    { preventDefault },
    pathToFileURL(resolve("examples/release-notes/renderer.html")).href,
  );
  expect(preventDefault).toHaveBeenCalledOnce();
  fixture.appEvents.get("web-contents-created")?.(null, {
    on: (_name: string, callback: (event: { preventDefault(): void }) => void) => {
      callback({ preventDefault });
    },
  });
  expect(preventDefault).toHaveBeenCalledTimes(2);
  fixture.appEvents.get("second-instance")?.();
  expect(fixture.window.focus).toHaveBeenCalledOnce();
  fixture.appEvents.get("window-all-closed")?.();
  expect(fixture.app.quit).toHaveBeenCalledOnce();
});

it("keeps the native close choice explicit and denies a second app instance", async () => {
  const choose = fixture.closeInstall.mock.calls[0]?.[3] as () => Promise<"wait" | "stop">;
  fixture.showMessageBox
    .mockResolvedValueOnce({ response: 0 })
    .mockResolvedValueOnce({ response: 1 });
  await expect(choose()).resolves.toBe("wait");
  await expect(choose()).resolves.toBe("stop");
  fixture.app.requestSingleInstanceLock.mockReturnValueOnce(false);
  vi.resetModules();
  await import("../src/main.js");
  expect(fixture.app.quit).toHaveBeenCalledTimes(2);
});
