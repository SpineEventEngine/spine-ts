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
