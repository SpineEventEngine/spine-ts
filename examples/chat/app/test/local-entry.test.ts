import { spawn, type ChildProcess } from "node:child_process";
import * as net from "node:net";

import { describe, expect, it } from "vitest";

const CompiledLocalChatProcess = Object.freeze({
  start(): Promise<ChildProcess> {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["examples/chat/app/dist/src/local-entry.js"], {
        cwd: process.cwd(),
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      child.stdout.on("data", (chunk: Buffer) => {
        output += chunk.toString();
        if (output.includes("Chat local server ready at http://127.0.0.1:8090")) resolve(child);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        output += chunk.toString();
      });
      child.once("error", reject);
      child.once("exit", (code) => {
        reject(new Error(`Chat local server exited before readiness: ${String(code)}: ${output}`));
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

describe("compiled local Chat entrypoint", () => {
  it.each(["SIGINT", "SIGTERM"] as const)(
    "exits successfully and releases port 8090 after %s",
    async (signal) => {
      const child = await CompiledLocalChatProcess.start();
      await expect(CompiledLocalChatProcess.stop(child, signal)).resolves.toBe(0);
      await expect(CompiledLocalChatProcess.bindPort()).resolves.toBeUndefined();
    },
    30_000,
  );
});
