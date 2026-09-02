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

import {
  chmodSync,
  constants,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { access, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { describe, expect, it, vi } from "vitest";

import { TodoProcessSignals } from "../src/process.js";
import { readMultiProcessSettings } from "../src/multi-process-settings.js";

const examplePackages = [
  "examples/projects/package.json",
  "examples/orders/package.json",
  "examples/todo/package.json",
] as const;

describe("example executable commands", () => {
  it.each(examplePackages.filter((path) => path !== "examples/todo/package.json"))(
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

  it("assigns the To-Do single-process build to its launcher exactly once", async () => {
    const manifest = JSON.parse(await readFile("examples/todo/package.json", "utf8")) as {
      readonly scripts: Readonly<Record<string, string>>;
    };
    const launcher = await readFile("examples/todo/scripts/run-single-process.sh", "utf8");

    expect(manifest.scripts.start).toBe("bash scripts/run-single-process.sh");
    expect(launcher.match(/pnpm typecheck:build/gu)).toHaveLength(1);
  });
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
      "2.0.0-snapshot.6",
    );
    expect(manifest.dependencies["@connectrpc/connect-node"]).toBe("2.1.2");
    expect(manifest.dependencies["@spine-event-engine/core"]).toBe("2.0.0-snapshot.6");
    expect(manifest.dependencies["@spine-event-engine/proto"]).toBe("2.0.0-snapshot.6");
    expect(manifest.dependencies["@spine-event-engine/server"]).toBe("2.0.0-snapshot.6");
    expect(manifest.devDependencies?.["@spine-event-engine/proto-tools"]).toBe("2.0.0-snapshot.6");
    expect(manifest.scripts.start).toBe("node dist/src/local-application-server.js");
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
  it("derives local endpoints from custom host and port inputs while keeping full overrides", () => {
    const directory = mkdtempSync(join(tmpdir(), "todo-launcher-"));
    const capture = join(directory, "environment");
    const node = join(directory, "node");
    writeFileSync(
      node,
      `#!/usr/bin/env bash\nprintf '%s\\n' "$DATASTORE_EMULATOR_HOST" "$DELIVERY_SERVER_URL" > "$TODO_CAPTURE"\n`,
    );
    chmodSync(node, 0o755);
    try {
      const run = (environment: NodeJS.ProcessEnv) =>
        spawnSync("bash", ["examples/todo/scripts/start-multi-process-app.sh"], {
          cwd: process.cwd(),
          encoding: "utf8",
          env: { ...process.env, ...environment, PATH: `${directory}:${process.env.PATH ?? ""}` },
        });

      expect(
        run({
          TODO_CAPTURE: capture,
          TODO_DATASTORE_HOST: "datastore.test",
          TODO_DATASTORE_PORT: "9011",
          TODO_DELIVERY_HOST: "delivery.test",
          TODO_DELIVERY_PORT: "9022",
        }).status,
      ).toBe(0);
      expect(readFileSync(capture, "utf8")).toBe(
        "datastore.test:9011\nhttp://delivery.test:9022\n",
      );

      expect(
        run({
          TODO_CAPTURE: capture,
          TODO_DATASTORE_EMULATOR_HOST: "explicit-datastore:8000",
          TODO_DELIVERY_URL: "https://explicit-delivery:9443/base",
        }).status,
      ).toBe(0);
      expect(readFileSync(capture, "utf8")).toBe(
        "explicit-datastore:8000\nhttps://explicit-delivery:9443/base\n",
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

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
    [
      {
        HOST: "127.0.0.1",
        PORT: "8080",
        DATASTORE_PROJECT_ID: "todo",
        DELIVERY_SERVER_URL: "http://delivery:8484",
        PROCESS_COUNT: "1.5",
        DELIVERY_SHARD_COUNT: "1",
      },
      "PROCESS_COUNT",
    ],
  ])("rejects invalid managed deployment configuration", (environment, expected) => {
    expect(() => readMultiProcessSettings(environment)).toThrow(expected);
  });

  it("keeps explicit process and shard counts independent", () => {
    expect(
      readMultiProcessSettings({
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

  it("keeps the barrel import side-effect free while exporting the public app API", async () => {
    const manifest = JSON.parse(await readFile("examples/todo/package.json", "utf8")) as {
      readonly dependencies: Readonly<Record<string, string>>;
      readonly scripts: Readonly<Record<string, string>>;
    };

    const api = await import("../dist/src/index.js");

    expect(api.createTodoContext).toBeTypeOf("function");
    expect(api.startTodoServer).toBeTypeOf("function");
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
    const emulatorLauncher = await readFile(
      "examples/todo/scripts/start-datastore-emulator.sh",
      "utf8",
    );
    const datastoreEmulatorImage = "google/cloud-sdk:578.0.0-emulators";
    expect(readme).toContain(datastoreEmulatorImage);
    expect(emulatorLauncher).toContain(datastoreEmulatorImage);
    expect(readme).not.toMatch(/⚠️|\\bwarning\\b|Why is the file called|sha256:/iu);
  });
});
