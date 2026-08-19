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

import { spawn, type ChildProcess } from "node:child_process";
import * as net from "node:net";

import { describe, expect, it } from "vitest";

const CompiledBoardProcess = Object.freeze({
  start(): Promise<ChildProcess> {
    return new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ["examples/message-board/app/dist/src/local-application-server.js"],
        {
          cwd: process.cwd(),
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let output = "";
      child.stdout.on("data", (chunk: Buffer) => {
        output += chunk.toString();
        if (output.includes("MessageBoard local server ready at http://127.0.0.1:8090"))
          resolve(child);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        output += chunk.toString();
      });
      child.once("error", reject);
      child.once("exit", (code) => {
        reject(
          new Error(
            `MessageBoard local server exited before readiness: ${String(code)}: ${output}`,
          ),
        );
      });
    });
  },
  stop(child: ChildProcess, signal: NodeJS.Signals): Promise<number | null> {
    return new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => {
        resolve(code);
      });
      child.kill(signal);
    });
  },
  bindPort(): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = net.createServer();
      server.once("error", reject);
      server.listen(8090, "127.0.0.1", () => {
        server.close((error) => {
          if (error === undefined) resolve();
          else reject(error);
        });
      });
    });
  },
});

describe("compiled local MessageBoard entrypoint", () => {
  it.each(["SIGINT", "SIGTERM"] as const)(
    "exits successfully and releases port 8090 after %s",
    async (signal) => {
      const child = await CompiledBoardProcess.start();
      await expect(CompiledBoardProcess.stop(child, signal)).resolves.toBe(0);
      await expect(CompiledBoardProcess.bindPort()).resolves.toBeUndefined();
    },
    30_000,
  );
});
