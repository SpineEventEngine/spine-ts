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

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { TodoProcessSignals } from "../src/process.js";

const examplePackages = [
  "examples/projects/package.json",
  "examples/orders/package.json",
  "examples/todo/package.json",
] as const;

describe("example executable commands", () => {
  it.each(examplePackages)(
    "makes %s own generation and TypeScript build preparation",
    async (path) => {
      const manifest = JSON.parse(await readFile(path, "utf8")) as {
        readonly scripts: Readonly<Record<string, string>>;
      };
      const command = manifest.scripts.load ?? manifest.scripts.start;

      expect(command).toContain("pnpm -C ../..");
      expect(command).toContain("typecheck:build");
    },
  );
});

describe("MessageBoard app manifest", () => {
  it("keeps exact runtime versions and starts already-built local output", async () => {
    const manifest = JSON.parse(
      await readFile("examples/message-board/app/package.json", "utf8"),
    ) as {
      readonly dependencies: Readonly<Record<string, string>>;
      readonly devDependencies?: Readonly<Record<string, string>>;
      readonly scripts: Readonly<Record<string, string>>;
    };

    expect(manifest.dependencies["@spine-event-engine/example-message-board-model"]).toBe(
      "2.0.0-snapshot.1",
    );
    expect(manifest.dependencies["@connectrpc/connect-node"]).toBe("2.1.2");
    expect(manifest.dependencies["@spine-event-engine/core"]).toBe("2.0.0-snapshot.1");
    expect(manifest.dependencies["@spine-event-engine/proto"]).toBe("2.0.0-snapshot.1");
    expect(manifest.dependencies["@spine-event-engine/server"]).toBe("2.0.0-snapshot.1");
    expect(manifest.devDependencies?.["@spine-event-engine/proto-tools"]).toBe("2.0.0-snapshot.1");
    expect(manifest.scripts.start).toBe("node dist/src/local-entry.js");
  });

  it("makes the MessageBoard web start command own workspace preparation", async () => {
    const manifest = JSON.parse(
      await readFile("examples/message-board/web/package.json", "utf8"),
    ) as {
      readonly scripts: Readonly<Record<string, string>>;
    };

    expect(manifest.scripts.start).toContain("typecheck:build");
  });
});

describe("To-Do process lifecycle", () => {
  it.each(["SIGINT", "SIGTERM"] as const)("closes the listener once after %s", async (signal) => {
    const handlers = new Map<string, () => void>();
    const close = vi.fn(() => Promise.resolve());
    const processLike = {
      once: (name: string, handler: () => void) => {
        handlers.set(name, handler);
      },
      exitCode: null as string | number | null | undefined,
    };

    TodoProcessSignals.install({ close }, processLike);
    handlers.get(signal)?.();
    handlers.get(signal)?.();
    await vi.waitFor(() => {
      expect(close).toHaveBeenCalledTimes(1);
    });
    expect(processLike.exitCode).toBe(0);
  });
});

describe("To-Do managed entrypoint", () => {
  it("keeps the local entry independent and provides an explicit complete-replica entry", async () => {
    const managed = "examples/todo/src/managed-entry.ts";
    expect(existsSync(managed)).toBe(true);
    const source = await readFile(managed, "utf8");
    const local = await readFile("examples/todo/src/index.ts", "utf8");
    const manifest = JSON.parse(await readFile("examples/todo/package.json", "utf8")) as {
      readonly dependencies: Readonly<Record<string, string>>;
      readonly scripts: Readonly<Record<string, string>>;
    };

    expect(source).toContain("ManagedServerApplication.run");
    expect(source).toContain("DatastoreStorageFactory");
    expect(source).toContain("RemoteDelivery.connectTo");
    expect(source).toContain("PROCESS_COUNT");
    expect(source).toContain("DELIVERY_SHARD_COUNT");
    expect(source).not.toMatch(/ZeroMQ|SPINE_IPC_DIRECTORY|SignalTransport/u);
    expect(local).not.toContain("ManagedServerApplication");
    expect(manifest.scripts["start:managed"]).toBe("node dist/src/managed-entry.js");
    expect(manifest.dependencies["@spine-event-engine/delivery-client"]).toBe("workspace:*");
    expect(manifest.dependencies["@spine-event-engine/storage-datastore"]).toBe("workspace:*");
  });
});
