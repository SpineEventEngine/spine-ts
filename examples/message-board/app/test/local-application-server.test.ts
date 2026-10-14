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
  start(webPort?: number): Promise<{ child: ChildProcess; port: number }> {
    return new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ["examples/message-board/app/dist/src/local-application-server.js"],
        {
          cwd: process.cwd(),
          stdio: ["ignore", "pipe", "pipe"],
          env: {
            ...process.env,
            MESSAGE_BOARD_LOCAL_PORT: "0",
            ...(webPort === undefined ? {} : { MESSAGE_BOARD_WEB_PORT: String(webPort) }),
          },
        },
      );
      let output = "";
      child.stdout.on("data", (chunk: Buffer) => {
        output += chunk.toString();
        const ready = /MessageBoard local server ready at http:\/\/127\.0\.0\.1:(\d+)/u.exec(
          output,
        );
        if (ready !== null) resolve({ child, port: Number(ready[1]) });
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
  bindPort(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = net.createServer();
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => {
        server.close((error) => {
          if (error === undefined) resolve();
          else reject(error);
        });
      });
    });
  },
});

describe("compiled local MessageBoard entrypoint", () => {
  it("admits the selected local UI origin on browser RPC preflight", async () => {
    const webPort = 25_173;
    const { child, port } = await CompiledBoardProcess.start(webPort);
    try {
      const origin = `http://127.0.0.1:${String(webPort)}`;
      const response = await fetch(
        `http://127.0.0.1:${String(port)}/spine.client.QueryService/Read`,
        {
          method: "OPTIONS",
          headers: { origin },
        },
      );
      expect(response.status).toBe(204);
      expect(response.headers.get("access-control-allow-origin")).toBe(origin);
    } finally {
      await CompiledBoardProcess.stop(child, "SIGTERM");
    }
  }, 30_000);

  it.each(["SIGINT", "SIGTERM"] as const)(
    "exits successfully and releases its selected port after %s",
    async (signal) => {
      const { child, port } = await CompiledBoardProcess.start();
      try {
        expect(port).toBeGreaterThan(0);
        expect(port).toBeLessThanOrEqual(65_535);
      } finally {
        await expect(CompiledBoardProcess.stop(child, signal)).resolves.toBe(0);
      }
      await expect(CompiledBoardProcess.bindPort(port)).resolves.toBeUndefined();
    },
    30_000,
  );
});
