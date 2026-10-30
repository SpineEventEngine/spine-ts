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

import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, workspace } from "@mobrowser/api";
import { VercelAx } from "@spine-event-engine/ai-vercel-ax";

import { CredentialStore } from "./trusted/credential-store.js";
import { DesktopAuth } from "./trusted/desktop-auth.js";
import { PlanModelSelection } from "./trusted/plan-model-selection.js";
import { registerStudioRpc } from "./trusted/studio-rpc.js";
import { ReleaseStudio } from "./trusted/studio-service.js";
import { StudioWindowClose } from "./trusted/studio-window-close.js";

const sourceDirectory = fileURLToPath(new URL(".", import.meta.url));

const workerPaths = (): { executable: string; worker: string } => {
  const resources = join(app.getPath("appResources"), "studio");
  const executable = join(resources, "node");
  const worker = join(resources, "main/git-worker.mjs");
  if (existsSync(executable) && existsSync(worker)) return { executable, worker };
  if (app.url.startsWith("http://localhost:") || app.url.startsWith("http://127.0.0.1:")) {
    const directory = join(sourceDirectory, "../..");
    const development = {
      executable: join(directory, "resources/node"),
      worker: join(directory, ".studio-build/git-worker.mjs"),
    };
    if (existsSync(development.executable) && existsSync(development.worker)) return development;
  }
  throw new Error("The packaged Git worker resources are missing.");
};

const StudioBootstrap = {
  /**
   * Creates session-only provider authentication and model selection.
   *
   * @returns Trusted account and model services.
   */
  accountServices(): { auth: DesktopAuth; plan: PlanModelSelection } {
    const session = VercelAx.chatgptPlanSession({
      agentName: "Release Notes Studio",
      credentials: new CredentialStore(),
    });
    const auth = new DesktopAuth(session, (url) => {
      if (new URL(url).origin !== "https://auth.openai.com")
        throw new Error("Invalid sign-in destination.");
      workspace.openUrl(url);
      return Promise.resolve();
    });
    return { auth, plan: new PlanModelSelection(auth, session) };
  },

  /**
   * Creates the native window with its browser boundary.
   *
   * @returns The application window before its renderer is loaded.
   */
  studioWindow(): BrowserWindow {
    const window = new BrowserWindow();
    window.setTitle("Release Notes Studio");
    window.setSize({ width: 1320, height: 900 });
    window.centerWindow();
    window.browser.handle("navigation", (params) =>
      params.url === app.url ? "proceed" : "cancel",
    );
    window.browser.handle("openPopup", () => "block");
    window.browser.handle("requestPermissions", () => Promise.resolve("deny"));
    window.browser.handle("selectMediaDevice", () => Promise.resolve("cancel"));
    return window;
  },

  /**
   * Gets the user's decision about stopping active work when the window closes.
   *
   * @param window Application window for the native dialog.
   * @returns The user's close decision.
   */
  async closeChoice(window: BrowserWindow): Promise<"wait" | "stop"> {
    const choice = await app.showMessageDialog({
      parentWindow: window,
      type: "warning",
      message: "Your release notes may still be in progress.",
      informativeText:
        "Wait keeps this window open. If you stop, your drafts will disappear and ChatGPT usage may still count.",
      buttons: [
        { label: "Wait", type: "primary" },
        { label: "Stop", type: "secondary" },
      ],
    });
    return choice.button.label === "Stop" ? "stop" : "wait";
  },
};

/**
 * Starts the release workflow and one native Studio window.
 */
export const StudioRuntime = {
  /**
   * Creates real account, domain, and IPC services before loading the renderer.
   *
   * @returns Completion after window creation.
   */
  async start(): Promise<void> {
    const { executable, worker } = workerPaths();
    const { auth, plan } = StudioBootstrap.accountServices();
    const studio = await ReleaseStudio.start({
      gitExecutable: "/usr/bin/git",
      workerExecutable: executable,
      workerPath: worker,
      workerCwd: app.getPath("userData"),
      plan,
    });
    const window = StudioBootstrap.studioWindow();
    StudioWindowClose.install(window, studio, auth, () => StudioBootstrap.closeChoice(window));
    registerStudioRpc({ window, auth, plan, studio });
    window.browser.loadUrl(app.url);
    window.show();
  },
};

app.on("allWindowsClosed", () => {
  app.quit();
});
void StudioRuntime.start().catch(() => {
  console.error("Studio could not start.");
  app.quit();
});
