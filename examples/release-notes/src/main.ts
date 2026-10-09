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

import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { app, BrowserWindow, ipcMain, safeStorage, shell, type IpcMainInvokeEvent } from "electron";
import { ModelRef } from "@spine-event-engine/ai";

import { CredentialStore } from "./trusted/credential-store.js";
import { DesktopAuth } from "./trusted/desktop-auth.js";
import { electronCipher, validateIpc } from "./trusted/electron-security.js";
import { SiwcSession } from "./trusted/siwc-session.js";
import { PlanModelSelection } from "./trusted/plan-model-selection.js";
import { windowOptions } from "./trusted/window-options.js";

const sourceDirectory = fileURLToPath(new URL(".", import.meta.url));
const rendererPath = join(sourceDirectory, "../renderer.html");
const preloadPath = join(sourceDirectory, "../preload.cjs");

const Runtime = {
  /**
   * Starts the restricted desktop window and account services.
   *
   * @returns Completion after the initial window loads.
   */
  async start(): Promise<void> {
    app.setName("Release Notes Studio");
    const store = new CredentialStore(
      join(app.getPath("userData"), "credentials"),
      electronCipher(safeStorage),
    );
    const session = new SiwcSession(store);
    const auth = new DesktopAuth(session, store, async (url) => {
      if (new URL(url).origin !== "https://auth.openai.com")
        throw new Error("Invalid sign-in destination.");
      await shell.openExternal(url);
    });
    const plan = new PlanModelSelection(auth, session);
    const window = new BrowserWindow(windowOptions(preloadPath));
    this.configureWindow(window, auth);
    this.registerIpc(window, auth, plan);
    await window.loadFile(rendererPath);
  },

  /**
   * Rejects window navigation, popups, webviews, and permission requests.
   *
   * @param window The application window.
   * @param auth The trusted account service to close with the window.
   */
  configureWindow(window: BrowserWindow, auth: DesktopAuth): void {
    const expectedFrameUrl = pathToFileURL(rendererPath).href;
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.session.setPermissionRequestHandler((_contents, _permission, respond) => {
      respond(false);
    });
    window.webContents.on("will-navigate", (event, url) => {
      if (url !== expectedFrameUrl) event.preventDefault();
    });
    app.on("web-contents-created", (_event, contents) => {
      contents.on("will-attach-webview", (event) => {
        event.preventDefault();
      });
    });
    window.on("closed", () => {
      void auth.close();
    });
  },

  /**
   * Registers one sender-validated renderer command channel.
   *
   * @param window The application window.
   * @param auth The trusted account service.
   * @param plan The selected plan model service.
   */
  registerIpc(window: BrowserWindow, auth: DesktopAuth, plan: PlanModelSelection): void {
    ipcMain.handle("release-notes:command", async (event, command: unknown, argument: unknown) => {
      try {
        return await this.command(window, auth, plan, event, command, argument);
      } catch {
        throw new Error("The requested account action could not be completed.");
      }
    });
  },

  /**
   * Routes a validated account or model command.
   *
   * @param window The application window that sent the command.
   * @param auth The trusted account service.
   * @param plan The selected plan model service.
   * @param event The Electron invocation with sender identity.
   * @param command The requested bounded command name.
   * @param argument The untrusted renderer argument.
   * @returns The credential-free command result.
   */
  async command(
    window: BrowserWindow,
    auth: DesktopAuth,
    plan: PlanModelSelection,
    event: IpcMainInvokeEvent,
    command: unknown,
    argument: unknown,
  ): Promise<unknown> {
    if (typeof command !== "string") throw new Error("Invalid command.");
    const account = validateIpc(
      {
        senderId: event.sender.id,
        expectedSenderId: window.webContents.id,
        frameUrl: event.senderFrame?.url ?? "",
        expectedFrameUrl: pathToFileURL(rendererPath).href,
      },
      command,
      argument,
    );
    return await this.route(auth, plan, command, account);
  },

  /**
   * Routes a validated renderer command to trusted account services.
   *
   * @param auth The trusted account service.
   * @param plan The selected plan model service.
   * @param command The validated command name.
   * @param account The validated command argument.
   * @returns The credential-free command result.
   */
  async route(
    auth: DesktopAuth,
    plan: PlanModelSelection,
    command: string,
    account: ReturnType<typeof validateIpc>,
  ): Promise<unknown> {
    const clientId = typeof account === "string" ? account : "";
    switch (command) {
      case "status":
        return await auth.status();
      case "sign-in":
        return await auth.signIn();
      case "reconnect":
        return await auth.signIn(clientId);
      case "select-account":
        return await auth.selectAccount(clientId);
      case "models":
        return await auth.models(clientId);
      case "select-model":
        return await this.selectModel(plan, account);
      case "sign-out":
        return await auth.signOut(clientId);
      case "usage":
        await shell.openExternal("https://chatgpt.com/#settings/usage");
        return null;
      default:
        throw new Error("Unknown command.");
    }
  },

  /**
   * Binds an account-advertised model to a stable registration reference.
   *
   * @param plan The selected plan model service.
   * @param account The validated account and model pair.
   * @returns The selected model label for the renderer.
   */
  async selectModel(
    plan: PlanModelSelection,
    account: ReturnType<typeof validateIpc>,
  ): Promise<{ model: string }> {
    if (account === null || typeof account === "string")
      throw new Error("Invalid model selection.");
    await plan.select(
      account.clientId,
      account.model,
      ModelRef.of("release-notes-plan", `${account.clientId}:${account.model}`),
    );
    return { model: account.model };
  },
};

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    BrowserWindow.getAllWindows()[0]?.focus();
  });
  app.on("window-all-closed", () => {
    app.quit();
  });
  void app.whenReady().then(() => Runtime.start());
}
