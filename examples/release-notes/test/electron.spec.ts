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
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

test("desktop shell opens one isolated window with account controls", async () => {
  const app = await electron.launch({ executablePath: electronPath, args: [directory] });
  try {
    const window = await app.firstWindow();
    await expect(window.getByRole("button", { name: "Continue with ChatGPT" })).toBeVisible();
    await expect(
      window.getByRole("button", { name: "Choose repository and comparison" }),
    ).toBeVisible();
    await expect(window.getByRole("button", { name: "Stop and quit" })).toBeVisible();
    expect(await window.evaluate(() => typeof process)).toBe("undefined");
    expect(await window.evaluate(() => typeof window.localStorage.getItem("access_token"))).toBe(
      "object",
    );
  } finally {
    await app.close();
  }
});

test("packaged macOS app opens the same isolated account shell", async () => {
  const executablePath = (await readFile(resolve(directory, "out/app-path.txt"), "utf8")).trim();
  const app = await electron.launch({ executablePath });
  try {
    const window = await app.firstWindow();
    await expect(window.getByRole("button", { name: "Continue with ChatGPT" })).toBeVisible();
    expect(await window.evaluate(() => typeof process)).toBe("undefined");
  } finally {
    await app.close();
  }
});

test("packaged editor opens an authoritative draft from a native-selected comparison", async () => {
  const repository = mkdtempSync(join(tmpdir(), "spine-packaged-draft-"));
  const git = (...args: string[]) =>
    execFileSync("/usr/bin/git", args, { cwd: repository, encoding: "utf8" }).trim();
  git("init", "--quiet");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.invalid");
  writeFileSync(join(repository, "notes.txt"), "Before\n");
  git("add", "notes.txt");
  git("commit", "--quiet", "-m", "Base");
  const base = git("rev-parse", "HEAD");
  writeFileSync(join(repository, "notes.txt"), "After\n");
  git("commit", "--quiet", "-am", "Release");
  const target = git("rev-parse", "HEAD");
  const executablePath = (await readFile(resolve(directory, "out/app-path.txt"), "utf8")).trim();
  const app = await electron.launch({ executablePath });
  try {
    await app.evaluate(({ dialog }, selected) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [selected] });
    }, repository);
    const window = await app.firstWindow();
    await window.getByLabel("Base revision").fill(base);
    await window.getByLabel("Target revision").fill(target);
    await window.getByRole("button", { name: "Choose repository and comparison" }).click();
    await expect(window.getByText(`${base} → ${target}`)).toBeVisible();
    await window.getByLabel("Release title").fill("Packaged release");
    await window.getByLabel("Audience").fill("SDK users");
    await window.getByRole("button", { name: "Open release draft" }).click();
    await expect(window.getByRole("heading", { name: "Packaged release" })).toBeVisible();
    await expect(window.getByRole("button", { name: "Generate draft" })).toBeDisabled();
    await window.getByLabel("Inspect committed evidence").selectOption("0");
    await expect(window.getByLabel("Committed patch")).toContainText("+After");
    await window.getByRole("button", { name: "Add section" }).click();
    await window.getByRole("button", { name: "Add claim" }).click();
    await window.getByLabel("Claim").fill("Changed release file.");
    await window.screenshot({ path: "/tmp/spine-release-notes-packaged.png", fullPage: true });
    await window.reload();
    await expect(window.getByRole("heading", { name: "Packaged release" })).toBeVisible();
  } finally {
    await app.close();
    rmSync(repository, { recursive: true, force: true });
  }
  const restarted = await electron.launch({ executablePath });
  try {
    const window = await restarted.firstWindow();
    await expect(window.getByRole("heading", { name: "Packaged release" })).toHaveCount(0);
    await expect(window.getByLabel("Session drafts")).toHaveCount(0);
  } finally {
    await restarted.close();
  }
});

test("development and packaged Electron binaries serve the scoped Git worker", async () => {
  const repository = mkdtempSync(join(tmpdir(), "spine-electron-git-"));
  try {
    const gitExecutable = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
    const git = (...args: string[]) =>
      execFileSync(gitExecutable, args, {
        cwd: repository,
        encoding: "utf8",
      }).trim();
    git("init", "--quiet");
    git("config", "user.name", "Fixture");
    git("config", "user.email", "fixture@example.invalid");
    writeFileSync(join(repository, "release.md"), "before\n");
    git("add", "release.md");
    git("commit", "--quiet", "-m", "Base");
    const base = git("rev-parse", "HEAD");
    writeFileSync(join(repository, "release.md"), "after\n");
    git("commit", "--quiet", "-am", "Release");
    const target = git("rev-parse", "HEAD");
    const comparison = await GitReleaseComparison.open({ repository, gitExecutable, base, target });
    const binding = JSON.stringify(comparison.workerBinding());
    const packagedExecutable = (
      await readFile(resolve(directory, "out/app-path.txt"), "utf8")
    ).trim();
    const workers = [
      [electronPath, resolve(directory, "dist/src/git-worker.mjs")],
      [
        packagedExecutable,
        resolve(packagedExecutable, "../../Resources/app.asar/src/git-worker.mjs"),
      ],
    ];
    for (const [executable, worker] of workers) {
      if (executable === undefined || worker === undefined) throw new Error("Worker path missing.");
      expect(await workerTools(executable, worker, binding)).toEqual([
        "list_release_changes",
        "read_change_patch",
        "read_release_file",
      ]);
    }
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("packaged runtime completes a real Agent generation, Git tool call, approval, and export", async () => {
  const executablePath = (await readFile(resolve(directory, "out/app-path.txt"), "utf8")).trim();
  const appRoot = resolve(executablePath, "../../Resources/app.asar");
  const output = execFileSync(
    executablePath,
    [resolve(directory, "test/packaged-studio-probe.mjs"), appRoot],
    {
      env: { ELECTRON_RUN_AS_NODE: "1" },
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 4096,
    },
  );
  expect(JSON.parse(output)).toEqual({ staged: true, attempts: 2, approved: true, exported: true });
});

test("isolated packaged UI generates, reviews history, approves, and saves exact native export bytes", async () => {
  const repository = mkdtempSync(join(tmpdir(), "spine-ui-workflow-"));
  const exportPath = join(repository, "approved.md");
  const git = (...args: string[]) =>
    execFileSync("/usr/bin/git", args, { cwd: repository, encoding: "utf8" }).trim();
  git("init", "--quiet");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.invalid");
  writeFileSync(join(repository, "notes.txt"), "Before\n");
  git("add", "notes.txt");
  git("commit", "--quiet", "-m", "Base");
  const base = git("rev-parse", "HEAD");
  writeFileSync(join(repository, "notes.txt"), "After\n");
  git("commit", "--quiet", "-am", "Release");
  const target = git("rev-parse", "HEAD");
  const executablePath = (await readFile(resolve(directory, "out/app-path.txt"), "utf8")).trim();
  const appRoot = resolve(executablePath, "../../Resources/app.asar");
  const app = await electron.launch({
    executablePath: electronPath,
    args: [
      resolve(directory, "test/studio-ui-harness.mjs"),
      appRoot,
      repository,
      exportPath,
      base,
      target,
    ],
  });
  try {
    const window = await app.firstWindow();
    await window.getByLabel("Base revision").fill(base);
    await window.getByLabel("Target revision").fill(target);
    await window.getByRole("button", { name: "Choose repository and comparison" }).click();
    await window.getByLabel("Release title").fill("UI release");
    await window.getByLabel("Audience").fill("SDK users");
    await window.getByRole("button", { name: "Open release draft" }).click();
    await window.getByLabel("Available to this account").selectOption("fixture-model");
    await expect(window.getByRole("button", { name: "Generate draft" })).toBeEnabled();
    await window.getByRole("button", { name: "Generate draft" }).click();
    await expect(window.getByLabel("Claim")).toHaveValue("Changed release file.");
    await window.getByRole("button", { name: "Preview release notes" }).click();
    const preview = await window.getByLabel("Markdown preview").textContent();
    expect(preview).toContain("Changed release file.");
    await window.getByRole("button", { name: "Approve reviewed notes" }).click();
    await app.evaluate(({ dialog }) => {
      dialog.showSaveDialog = () => Promise.resolve({ canceled: true, filePath: "" });
    });
    await window.getByRole("button", { name: "Export approved release notes" }).click();
    await expect(window.getByRole("status")).toHaveText("Export cancelled; no file was written.");
    expect(await readFile(exportPath, "utf8").catch(() => null)).toBeNull();
    await app.evaluate(({ dialog }, selected) => {
      dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: selected });
    }, repository);
    await window.getByRole("button", { name: "Export approved release notes" }).click();
    await expect(window.getByRole("status")).toContainText("Read the current draft");
    expect(await readFile(exportPath, "utf8").catch(() => null)).toBeNull();
    await window.reload();
    await expect(
      window.getByRole("button", { name: "Export approved release notes" }),
    ).toBeEnabled();
    await app.evaluate(({ dialog }, selected) => {
      dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: selected });
    }, exportPath);
    await window.getByRole("button", { name: "Export approved release notes" }).click();
    await expect.poll(async () => readFile(exportPath, "utf8").catch(() => null)).toBe(preview);
    await window.getByRole("button", { name: "Export approved release notes" }).click();
    await expect(window.getByRole("status")).toHaveText("Approved Markdown exported.");
    expect(await readFile(exportPath, "utf8")).toBe(preview);
    await window
      .getByRole("region", { name: "Agent history" })
      .getByLabel("View")
      .selectOption("conversation");
    await window.getByRole("button", { name: "Load history" }).click();
    await expect(window.getByRole("region", { name: "Agent history" })).toContainText(
      "Model or tool exchange",
    );
    await window.screenshot({ path: "/tmp/spine-release-notes-controlled-ui.png", fullPage: true });
  } finally {
    await app.close();
    rmSync(repository, { recursive: true, force: true });
  }
});
