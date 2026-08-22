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

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { describe, expect, expectTypeOf, it } from "vitest";

import * as serverRoot from "@spine-event-engine/server";
import { resetServerEnvironmentForTest } from "@spine-event-engine/server/testing";

type RootExports = typeof import("@spine-event-engine/server");

type BrowserExports = typeof import("@spine-event-engine/server/browser");

type HandlerRegistrySpiExports = typeof import("@spine-event-engine/server/spi/handler-registry");

describe("@spine-event-engine/server package exports", () => {
  it("keeps browser and durable-auth APIs out of the native root and exposes them only at browser", async () => {
    expect("BrowserServer" in serverRoot).toBe(false);
    expect("BrowserServerOptions" in serverRoot).toBe(false);
    expect("DurableSubscriptionBindings" in serverRoot).toBe(false);
    expectTypeOf<"BrowserServer" extends keyof RootExports ? true : false>().toEqualTypeOf<false>();
    expectTypeOf<
      "DurableSubscriptionBindings" extends keyof RootExports ? true : false
    >().toEqualTypeOf<false>();
    expectTypeOf<
      "BrowserServer" extends keyof BrowserExports ? true : false
    >().toEqualTypeOf<true>();
    expectTypeOf<
      "DurableSubscriptionBindings" extends keyof BrowserExports ? true : false
    >().toEqualTypeOf<true>();

    const browser = await import("@spine-event-engine/server/browser");
    expect(typeof browser.BrowserServer.open).toBe("function");
    expect(typeof browser.BrowserServer.run).toBe("function");
    expect(Object.keys(browser.BrowserServer).sort()).toEqual(["open", "run"]);
    expect(typeof browser.DurableSubscriptionBindings).toBe("function");
  });

  it("connects the public browser facade to production implementation names", () => {
    const source = readFileSync(new URL("../src/browser/index.ts", import.meta.url), "utf8");

    expect(source).toContain('from "./browser-server.js"');
    expect(source).toContain("browserServerImplementation");
    expect(source).not.toContain("browserServerTestAccess");
  });

  it("emits a native root declaration with no auth or browser resolution path", () => {
    const declaration = readFileSync(new URL("../dist/index.d.ts", import.meta.url), "utf8");

    expect(declaration).not.toMatch(/auth|browser|connect-node|node:http/iu);
  });

  it("keeps reset out of the root declaration and runtime export", () => {
    expect("resetServerEnvironmentForTest" in serverRoot).toBe(false);
    expectTypeOf<
      "resetServerEnvironmentForTest" extends keyof RootExports ? true : false
    >().toEqualTypeOf<false>();
  });

  it("resolves root and testing subpaths through package exports on one singleton graph", () => {
    const output = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `import * as root from "@spine-event-engine/server";
         import { resetServerEnvironmentForTest as reset } from "@spine-event-engine/server/testing";
         await reset();
         const first = root.ServerEnvironment.instance();
         await reset();
         const second = root.ServerEnvironment.instance();
         process.stdout.write(JSON.stringify({
           hasResetAtRoot: "resetServerEnvironmentForTest" in root,
           changedAfterTestingReset: first !== second,
           nodeChangedAfterTestingReset: first.nodeId !== second.nodeId,
         }));`,
      ],
      { cwd: new URL("..", import.meta.url), encoding: "utf8" },
    );

    expect(JSON.parse(output)).toEqual({
      hasResetAtRoot: false,
      changedAfterTestingReset: true,
      nodeChangedAfterTestingReset: true,
    });
    void resetServerEnvironmentForTest;
  });

  it("resolves the delivery SPI through its declared package subpath", () => {
    const output = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `import { conditionalPickUp } from "@spine-event-engine/server/spi/delivery";
         process.stdout.write(typeof conditionalPickUp.register);`,
      ],
      { cwd: new URL("..", import.meta.url), encoding: "utf8" },
    );

    expect(output).toBe("function");
  });

  it("exposes generated handler-registry data only through its SPI subpath", async () => {
    expectTypeOf<
      "GeneratedHandlerRegistry" extends keyof HandlerRegistrySpiExports ? true : false
    >().toEqualTypeOf<true>();
    expectTypeOf<
      "HandlerRegistryIngestor" extends keyof HandlerRegistrySpiExports ? true : false
    >().toEqualTypeOf<false>();
    expectTypeOf<
      "HandlerRegistryIngestionError" extends keyof HandlerRegistrySpiExports ? true : false
    >().toEqualTypeOf<false>();
    expectTypeOf<
      "RegistryIngestionErrorCode" extends keyof HandlerRegistrySpiExports ? true : false
    >().toEqualTypeOf<false>();

    const registry = await import("@spine-event-engine/server/spi/handler-registry");
    expect(Object.keys(registry)).toEqual([]);
  });

  it("restores local defaults after testing reset from a production-profile process", () => {
    const output = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `import * as root from "@spine-event-engine/server";
         import { resetServerEnvironmentForTest as reset } from "@spine-event-engine/server/testing";
         const initialType = root.Environment.instance().type;
         await reset();
         const environment = root.ServerEnvironment.instance();
         process.stdout.write(JSON.stringify({
           initialType,
           resetType: root.Environment.instance().type,
           facilityType: environment.environment.type,
           storageType: environment.storageFactory.constructor.name,
         }));`,
      ],
      {
        cwd: new URL("..", import.meta.url),
        encoding: "utf8",
        env: { ...process.env, NODE_ENV: "production" },
      },
    );

    expect(JSON.parse(output)).toEqual({
      initialType: "production",
      resetType: "local",
      facilityType: "local",
      storageType: "InMemoryStorageFactory",
    });
  });
});
