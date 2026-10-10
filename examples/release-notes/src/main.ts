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
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  safeStorage,
  shell,
  type IpcMainInvokeEvent,
} from "electron";

import { CredentialStore } from "./trusted/credential-store.js";
import { DesktopAuth } from "./trusted/desktop-auth.js";
import { assertIpcSender, electronCipher, validateIpc } from "./trusted/electron-security.js";
import { SiwcSession } from "./trusted/siwc-session.js";
import { PlanModelSelection } from "./trusted/plan-model-selection.js";
import { ReleaseStudio } from "./trusted/studio-service.js";
import { isStudioIpcCommand, validateStudioIpc } from "./trusted/studio-ipc.js";
import { StudioDesktop } from "./trusted/studio-desktop.js";
import { StudioAccountGate } from "./trusted/studio-account-gate.js";
import { StudioIpcErrors } from "./trusted/studio-ipc-errors.js";
import { StudioWindowClose } from "./trusted/studio-window-close.js";
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
    const studio = await ReleaseStudio.start({
      gitExecutable: "/usr/bin/git",
      workerExecutable: process.execPath,
      workerPath: join(sourceDirectory, "git-worker.mjs"),
      workerCwd: app.getPath("userData"),
      registryRoot: new URL("../", import.meta.url),
      plan,
    });
    const window = new BrowserWindow(windowOptions(preloadPath));
    this.configureWindow(window, auth, studio);
    this.registerIpc(window, auth, plan, studio);
    await window.loadFile(rendererPath);
  },

  /**
   * Rejects window navigation, popups, webviews, and permission requests.
   *
   * @param window The application window.
   * @param auth The trusted account service to close with the window.
   * @param studio In-memory Bounded Context to stop on window close.
   */
  configureWindow(window: BrowserWindow, auth: DesktopAuth, studio: ReleaseStudio): void {
    this.restrictWindow(window);
    this.confirmClose(window, auth, studio);
  },

  /**
   * Rejects unexpected renderer navigation, popups, permissions, and webviews.
   *
   * @param window Isolated release editor window.
   */
  restrictWindow(window: BrowserWindow): void {
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
  },

  /**
   * Checks whether the user will wait or stop the Bounded Context before closing.
   *
   * @param window Isolated release editor window.
   * @param auth Trusted account service closed with the window.
   * @param studio In-memory release workflow closed with the window.
   */
  confirmClose(window: BrowserWindow, auth: DesktopAuth, studio: ReleaseStudio): void {
    StudioWindowClose.install(window, studio, auth, async () => {
      const choice = await dialog.showMessageBox(window, {
        type: "warning",
        buttons: ["Wait", "Stop and quit"],
        defaultId: 0,
        cancelId: 0,
        message: "Your release notes may still be in progress.",
        detail:
          "Wait keeps this window open. If you stop and quit, your drafts will disappear and ChatGPT usage may still count.",
      });
      return choice.response === 1 ? "stop" : "wait";
    });
  },

  /**
   * Registers one sender-validated renderer command channel.
   *
   * @param window The application window.
   * @param auth The trusted account service.
   * @param plan The selected plan model service.
   * @param studio In-memory release workflow for renderer actions.
   */
  registerIpc(
    window: BrowserWindow,
    auth: DesktopAuth,
    plan: PlanModelSelection,
    studio: ReleaseStudio,
  ): void {
    ipcMain.handle("release-notes:command", async (event, command: unknown, argument: unknown) => {
      return StudioIpcErrors.execute(command, () =>
        this.command(window, auth, plan, studio, event, command, argument),
      );
    });
  },

  /**
   * Routes a validated account or model command.
   *
   * @param window The application window that sent the command.
   * @param auth The trusted account service.
   * @param plan The selected plan model service.
   * @param studio In-memory release workflow for renderer actions.
   * @param event The Electron invocation with sender identity.
   * @param command The requested bounded command name.
   * @param argument The untrusted renderer argument.
   * @returns The credential-free command result.
   */
  async command(
    window: BrowserWindow,
    auth: DesktopAuth,
    plan: PlanModelSelection,
    studio: ReleaseStudio,
    event: IpcMainInvokeEvent,
    command: unknown,
    argument: unknown,
  ): Promise<unknown> {
    if (typeof command !== "string") throw new Error("Invalid command.");
    const sender = {
      senderId: event.sender.id,
      expectedSenderId: window.webContents.id,
      frameUrl: event.senderFrame?.url ?? "",
      expectedFrameUrl: pathToFileURL(rendererPath).href,
    };
    assertIpcSender(sender);
    if (isStudioIpcCommand(command))
      return StudioDesktop.action(window, studio, command, validateStudioIpc(command, argument));
    const account = validateIpc(sender, command, argument);
    return await this.route(auth, plan, studio, command, account);
  },

  /**
   * Routes a validated renderer command to trusted account services.
   *
   * @param auth The trusted account service.
   * @param plan The selected plan model service.
   * @param studio In-memory workflow used to check active account binding.
   * @param command The validated command name.
   * @param account The validated command argument.
   * @returns The credential-free command result.
   */
  async route(
    auth: DesktopAuth,
    plan: PlanModelSelection,
    studio: ReleaseStudio,
    command: string,
    account: ReturnType<typeof validateIpc>,
  ): Promise<unknown> {
    return StudioAccountGate.run(studio, command, account, () =>
      this.accountAction(auth, plan, command, account),
    );
  },

  /**
   * Dispatches a validated account action without returning credentials.
   *
   * @param auth Trusted account service.
   * @param plan Selected plan model service.
   * @param command Fixed account action name.
   * @param account Validated account action input.
   * @returns Credential-free action result.
   */
  async accountAction(
    auth: DesktopAuth,
    plan: PlanModelSelection,
    command: string,
    account: ReturnType<typeof validateIpc>,
  ): Promise<unknown> {
    const clientId = typeof account === "string" ? account : "";
    switch (command) {
      case "status":
        return await auth.status();
      case "current-model":
        return { model: (await plan.activeBinding())?.model ?? "" };
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
   * Binds an account-advertised model to this account's registration reference.
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
    await plan.selectDiscovered(account.clientId, account.model);
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
