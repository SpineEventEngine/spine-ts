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

import { constants, existsSync } from "node:fs";
import { access, readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import { TodoProcessSignals } from "../src/process.js";
import { readTodoMultiProcessSettings } from "../src/multi-process-settings.js";

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
  it.each([
    [{}, "HOST"],
    [{ HOST: "127.0.0.1" }, "PORT"],
    [
      {
        HOST: "127.0.0.1",
        PORT: "0",
        DATASTORE_PROJECT_ID: "todo",
        DELIVERY_SERVER_URL: "http://delivery:8484",
        PROCESS_COUNT: "1",
        DELIVERY_SHARD_COUNT: "1",
      },
      "PORT",
    ],
    [
      {
        HOST: "127.0.0.1",
        PORT: "8080",
        DATASTORE_PROJECT_ID: "todo",
        DELIVERY_SERVER_URL: "ftp://delivery:8484",
        PROCESS_COUNT: "1",
        DELIVERY_SHARD_COUNT: "1",
      },
      "DELIVERY_SERVER_URL",
    ],
  ])("rejects invalid managed deployment configuration", (environment, expected) => {
    expect(() => readTodoMultiProcessSettings(environment)).toThrow(expected);
  });

  it("keeps explicit process and shard counts independent", () => {
    expect(
      readTodoMultiProcessSettings({
        HOST: "0.0.0.0",
        PORT: "8080",
        DATASTORE_PROJECT_ID: "todo",
        DELIVERY_SERVER_URL: "http://delivery:8484/",
        PROCESS_COUNT: "3",
        DELIVERY_SHARD_COUNT: "5",
      }),
    ).toMatchObject({
      processCount: 3,
      deliveryShardCount: 5,
      deliveryServerUrl: "http://delivery:8484",
    });
  });

  it("separates the two app modes, Coordinator, replica, and shared application", async () => {
    const paths = {
      shared: "examples/todo/src/todo-app.ts",
      single: "examples/todo/src/single-process-app.ts",
      multi: "examples/todo/src/multi-process-app.ts",
      coordinator: "examples/todo/src/multi-process-coordinator.ts",
      replica: "examples/todo/src/multi-process-replica.ts",
      settings: "examples/todo/src/multi-process-settings.ts",
    } as const;
    for (const path of Object.values(paths)) expect(existsSync(path), path).toBe(true);
    if (Object.values(paths).some((path) => !existsSync(path))) return;

    const shared = await readFile(paths.shared, "utf8");
    const single = await readFile(paths.single, "utf8");
    const multi = await readFile(paths.multi, "utf8");
    const coordinator = await readFile(paths.coordinator, "utf8");
    const replica = await readFile(paths.replica, "utf8");
    const settings = await readFile(paths.settings, "utf8");
    const index = await readFile("examples/todo/src/index.ts", "utf8");
    const manifest = JSON.parse(await readFile("examples/todo/package.json", "utf8")) as {
      readonly dependencies: Readonly<Record<string, string>>;
      readonly scripts: Readonly<Record<string, string>>;
    };

    expect(index).toContain('export * from "./todo-app.js"');
    expect(index).not.toContain(".start()");
    expect(shared).toContain("createTodoContext");
    expect(shared).not.toContain("Server.atPort");
    expect(single).toContain("startTodoServer");
    expect(single).not.toContain("ManagedServerApplication");
    expect(multi).toContain("ManagedServerApplication.run");
    expect(multi).toContain("createTodoReplica");
    expect(multi).toContain("runTodoCoordinator");
    expect(coordinator).toContain("SIGTERM");
    expect(coordinator).not.toMatch(/Datastore|RemoteDelivery|Server\\.atPort/u);
    expect(replica).toContain("InMemorySubscriptionRegistry");
    expect(replica).toContain("subscriptionRegistry: new InMemorySubscriptionRegistry()");
    expect(replica).toContain("DatastoreStorageFactory");
    expect(replica).toContain("new StringifierRegistry()");
    expect(replica).toContain("stringifiers.setTypeRegistry(typeRegistry)");
    expect(replica).toContain(".setStringifierRegistry(stringifiers)");
    expect(replica).toContain("RemoteDelivery.connectTo");
    expect(replica).not.toMatch(/SIGINT|SIGTERM|ManagedServerApplication/u);
    expect(settings).toContain("PROCESS_COUNT");
    expect(settings).toContain("DELIVERY_SHARD_COUNT");
    expect(multi).not.toMatch(/SPINE_IPC_DIRECTORY/u);
    expect(manifest.scripts["start:single-process"]).toContain("run-single-process.sh");
    expect(manifest.scripts["start:multi-process"]).toContain("run-multi-process.sh");
    expect(manifest.dependencies["@spine-event-engine/delivery-client"]).toBe("workspace:*");
    expect(manifest.dependencies["@spine-event-engine/storage-datastore"]).toBe("workspace:*");
  });

  it("provides commented executable launchers that own multi-process cleanup", async () => {
    const scripts = [
      "examples/todo/scripts/run-single-process.sh",
      "examples/todo/scripts/run-multi-process.sh",
      "examples/todo/scripts/start-datastore-emulator.sh",
      "examples/todo/scripts/start-delivery-server.sh",
      "examples/todo/scripts/start-multi-process-app.sh",
    ] as const;
    for (const path of scripts) {
      expect(existsSync(path), path).toBe(true);
      if (!existsSync(path)) continue;
      await expect(access(path, constants.X_OK)).resolves.toBeUndefined();
      const source = await readFile(path, "utf8");
      expect(source).toMatch(/^#!\/usr\/bin\/env bash\n(?:#.*\n)+/u);
    }
    if (!existsSync(scripts[1])) return;
    const orchestrator = await readFile(scripts[1], "utf8");
    expect(orchestrator).toContain("trap cleanup EXIT");
    expect(orchestrator).toContain("start-datastore-emulator.sh");
    expect(orchestrator).toContain("start-delivery-server.sh");
    expect(orchestrator).toContain("start-multi-process-app.sh");
    expect(orchestrator).toContain('wait "$app_pid"');
  });

  it("documents both runnable modes without warnings or internal Q&A", async () => {
    const readme = await readFile("examples/todo/README.md", "utf8");

    expect(readme).toContain("## Running the app");
    expect(readme).toContain("### Single-process app");
    expect(readme).toContain("### Multi-process app");
    expect(readme).toContain("scripts/run-single-process.sh");
    expect(readme).toContain("scripts/run-multi-process.sh");
    expect(readme).toContain("single-process-app.ts");
    expect(readme).toContain("multi-process-app.ts");
    expect(readme).toContain("multi-process-coordinator.ts");
    expect(readme).toContain("multi-process-replica.ts");
    expect(readme).toContain("Event Store");
    expect(readme).toContain("google-cloud-cli:emulators");
    expect(readme).not.toMatch(/⚠️|\\bwarning\\b|Why is the file called|sha256:/iu);
  });
});
