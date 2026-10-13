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

import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { _electron as electron, expect, test } from "@playwright/test";
import { GitReleaseComparison } from "../src/trusted/git-release.js";

const directory = resolve(fileURLToPath(new URL("..", import.meta.url)));
const electronPath = createRequire(import.meta.url)("electron") as string;

async function workerTools(executable: string, worker: string, binding: string): Promise<string[]> {
  const child = spawn(executable, [worker], {
    env: { ELECTRON_RUN_AS_NODE: "1", SPINE_RELEASE_GIT_BINDING: binding },
    stdio: ["pipe", "pipe", "ignore"],
    shell: false,
  });
  let pending = "";
  const responses = new Map<number, unknown>();
  child.stdout.on("data", (chunk: Buffer) => {
    pending += chunk.toString("utf8");
    for (let end = pending.indexOf("\n"); end >= 0; end = pending.indexOf("\n")) {
      const response = JSON.parse(pending.slice(0, end)) as { id?: number };
      pending = pending.slice(end + 1);
      if (response.id !== undefined) responses.set(response.id, response);
    }
  });
  const send = (value: object) => child.stdin.write(`${JSON.stringify(value)}\n`);
  try {
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "packaged-probe", version: "1" },
      },
    });
    await expect.poll(() => responses.has(1)).toBe(true);
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    await expect.poll(() => responses.has(2)).toBe(true);
    const response = responses.get(2) as { result?: { tools?: { name: string }[] } };
    return response.result?.tools?.map((tool) => tool.name).sort() ?? [];
  } finally {
    child.stdin.end();
    await new Promise<void>((complete) => {
      child.once("close", () => {
        complete();
      });
    });
  }
}

test("development and packaged apps open the isolated sign-in dialog", async () => {
  const packaged = (await readFile(resolve(directory, "out/app-path.txt"), "utf8")).trim();
  for (const [executablePath, args] of [
    [electronPath, [directory]],
    [packaged, []],
  ] as [string, string[]][]) {
    const app = await electron.launch({ executablePath, args });
    try {
      const window = await app.firstWindow();
      await window.setViewportSize({ width: 1536, height: 1024 });
      await expect(window.getByRole("dialog", { name: "Welcome" })).toBeVisible();
      await expect(
        window.getByRole("button", {
          name: /Sign in with ChatGPT|Continue sign-in|Reconnect ChatGPT account/,
        }),
      ).toBeVisible();
      await expect(window.getByRole("button", { name: "New release" })).toHaveCount(0);
      expect(await window.evaluate(() => typeof process)).toBe("undefined");
    } finally {
      await app.close();
    }
  }
});

test("packaged sample flow chooses real refs, writes, edits, previews, and exports exact Markdown", async () => {
  test.setTimeout(90_000);
  const fixtureRoot = mkdtempSync(join(tmpdir(), "spine-flow-ui-"));
  const repository = join(fixtureRoot, "Customer portal");
  mkdirSync(repository);
  const git = (...args: string[]) =>
    execFileSync("/usr/bin/git", args, { cwd: repository, encoding: "utf8" }).trim();
  const exportPath = join(repository, "release.md");
  git("init", "--quiet");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.invalid");
  writeFileSync(join(repository, "import.ts"), "export const value = 1;\n");
  git("add", "import.ts");
  git("commit", "--quiet", "-m", "Base");
  const base = git("rev-parse", "HEAD");
  writeFileSync(join(repository, "import.ts"), "export const value = 2;\n");
  git("commit", "--quiet", "-am", "Improve import");
  const target = git("rev-parse", "HEAD");
  const executablePath = (await readFile(resolve(directory, "out/app-path.txt"), "utf8")).trim();
  const appRoot = resolve(executablePath, "../../Resources/app.asar");
  const fixtureArgs = [
    resolve(directory, "test/studio-flow-harness.mjs"),
    appRoot,
    repository,
    exportPath,
    base,
    target,
  ];
  const signInApp = await electron.launch({
    executablePath: electronPath,
    args: [...fixtureArgs, "--signed-out"],
  });
  try {
    const welcome = await signInApp.firstWindow();
    await welcome.setViewportSize({ width: 1536, height: 1024 });
    await expect(welcome.getByRole("button", { name: "Sign in with ChatGPT" })).toBeVisible();
    await welcome.screenshot({ path: "/tmp/spine-redesign-signin.png" });
  } finally {
    await signInApp.close();
  }
  const app = await electron.launch({
    executablePath: electronPath,
    args: fixtureArgs,
  });
  try {
    const window = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.webContents.setZoomFactor(1);
    });
    await window.setViewportSize({ width: 1536, height: 1024 });
    await expect(window.getByRole("heading", { name: "Your releases" })).toBeVisible();
    await window.screenshot({ path: "/tmp/spine-redesign-dashboard.png" });
    await window.getByRole("button", { name: "New release" }).click();
    await expect(window.getByRole("heading", { name: "Choose changes" })).toBeVisible();
    await window.screenshot({ path: "/tmp/spine-redesign-changes.png" });
    await window.getByRole("button", { name: "Choose a Git project" }).click();
    await expect(window.getByRole("combobox", { name: "From" })).toBeEnabled();
    await window.getByRole("combobox", { name: "From" }).click();
    await expect(window.getByRole("option", { name: "HEAD~1" })).toBeVisible();
    await window.screenshot({ path: "/tmp/spine-redesign-ref-dropdown.png" });
    await window.getByRole("option", { name: "HEAD~1" }).click();
    await window.getByRole("combobox", { name: "To" }).click();
    await window.getByRole("option", { name: "HEAD", exact: true }).click();
    await window.getByRole("textbox", { name: "Release" }).fill("v2.4.0");
    await expect(window.getByText("1 commit · 1 file")).toBeVisible();
    await window.screenshot({ path: "/tmp/spine-redesign-changes-filled.png" });
    await window.getByRole("button", { name: "Next" }).click();
    await expect(window.getByRole("heading", { name: "Writing style" })).toBeVisible();
    await window.getByRole("combobox", { name: "Model" }).click();
    await expect(window.getByRole("option", { name: "Demo model" })).toBeVisible();
    await window.screenshot({ path: "/tmp/spine-redesign-model-dropdown.png" });
    await window.getByRole("option", { name: "Demo model" }).click();
    await expect(window.getByRole("button", { name: "Write" })).toBeEnabled();
    await window.screenshot({ path: "/tmp/spine-redesign-style.png" });
    await window.getByRole("button", { name: "Write" }).click();
    await window.screenshot({ path: "/tmp/spine-redesign-writing.png" });
    const editor = window.getByRole("textbox", { name: "Markdown" });
    await expect(editor).toHaveValue(/Find messages faster/, {
      timeout: 30_000,
    });
    const text =
      "# Customer portal v2.4.0\n\n## What's new\n- Find messages faster with improved search.\n- Export filtered results as CSV.\n\n## Improvements\n- The inbox loads faster for large teams.\n\n## Fixes\n- Corrected dates in downloaded reports.\n";
    await editor.fill(text);
    await expect(window.getByRole("status")).toHaveText("Saved for this session");
    await window.screenshot({ path: "/tmp/spine-redesign-editor.png" });
    await window.getByRole("button", { name: "Copy Markdown" }).click();
    await expect(window.getByText("Markdown copied.")).toBeVisible();
    await window.getByRole("tab", { name: "Preview" }).click();
    await expect(window.getByRole("tabpanel", { name: "Preview" })).toContainText(
      "Corrected dates",
    );
    await window.screenshot({ path: "/tmp/spine-redesign-preview.png" });
    await window.setViewportSize({ width: 1200, height: 788 });
    await window.screenshot({ path: "/tmp/spine-redesign-normal-preview.png" });
    await window.setViewportSize({ width: 1536, height: 1024 });
    await window.getByRole("button", { name: "Export" }).click();
    await expect.poll(async () => readFile(exportPath, "utf8").catch(() => null)).toBe(text);
    await window.getByRole("button", { name: "Dashboard" }).click();
    await expect(window.getByRole("button", { name: /Customer portal/ })).toBeVisible();
    await expect(window.getByText("Markdown exported.")).toHaveCount(0);
    await window.screenshot({ path: "/tmp/spine-redesign-dashboard-populated.png" });
    await window.setViewportSize({ width: 640, height: 480 });
    await window.screenshot({ path: "/tmp/spine-redesign-narrow.png" });
    await window.getByRole("button", { name: "New release" }).click();
    await window.screenshot({ path: "/tmp/spine-redesign-narrow-changes.png" });
    expect(await window.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await window.getByRole("button", { name: "Sign out" }).click();
    await expect(window.getByRole("dialog", { name: "Welcome" })).toBeVisible();
    await expect(window.getByRole("button", { name: "New release" })).toHaveCount(0);
  } finally {
    await app.close();
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("development and packaged Electron binaries serve the scoped Git worker", async () => {
  const repository = mkdtempSync(join(tmpdir(), "spine-electron-git-"));
  try {
    const git = (...args: string[]) =>
      execFileSync("/usr/bin/git", args, { cwd: repository, encoding: "utf8" }).trim();
    git("init", "--quiet");
    git("config", "user.name", "Fixture");
    git("config", "user.email", "fixture@example.invalid");
    writeFileSync(join(repository, "release.md"), "before\n");
    git("add", "release.md");
    git("commit", "--quiet", "-m", "Base");
    const base = git("rev-parse", "HEAD");
    writeFileSync(join(repository, "release.md"), "after\n");
    git("commit", "--quiet", "-am", "Release");
    const comparison = await GitReleaseComparison.open({
      repository,
      gitExecutable: "/usr/bin/git",
      base,
      target: git("rev-parse", "HEAD"),
    });
    const binding = JSON.stringify(comparison.workerBinding());
    const packaged = (await readFile(resolve(directory, "out/app-path.txt"), "utf8")).trim();
    for (const [executable, worker] of [
      [electronPath, resolve(directory, "dist/src/git-worker.mjs")],
      [packaged, resolve(packaged, "../../Resources/app.asar/src/git-worker.mjs")],
    ]) {
      if (!executable || !worker) throw new Error("Worker path missing.");
      expect(await workerTools(executable, worker, binding)).toEqual([
        "list_release_changes",
        "read_change_patch",
        "read_net_change_patch",
        "read_release_file",
      ]);
    }
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("packaged runtime completes generation and exact neutral Markdown export", async () => {
  const executablePath = (await readFile(resolve(directory, "out/app-path.txt"), "utf8")).trim();
  const appRoot = resolve(executablePath, "../../Resources/app.asar");
  const output = execFileSync(
    executablePath,
    [resolve(directory, "test/packaged-studio-probe.mjs"), appRoot],
    { env: { ELECTRON_RUN_AS_NODE: "1" }, encoding: "utf8", timeout: 30_000, maxBuffer: 4096 },
  );
  expect(JSON.parse(output)).toEqual({ staged: true, attempts: 2, exported: true });
});
