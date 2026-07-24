import { execFileSync } from "node:child_process";

import { describe, expect, expectTypeOf, it } from "vitest";

import * as serverRoot from "@spine-event-engine/server";
import { resetServerEnvironmentForTest } from "@spine-event-engine/server/testing";

type RootExports = typeof import("@spine-event-engine/server");

describe("@spine-event-engine/server package exports", () => {
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
