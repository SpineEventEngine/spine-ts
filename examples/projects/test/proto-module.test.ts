import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { projectManagementProtoModule } from "@spine-event-engine/example-project-management";

const packageRoot = new URL("..", import.meta.url);

describe("Project Management Proto model package", () => {
  it("publishes its frozen owned schema module and canonical manifest", () => {
    const manifest = JSON.parse(
      readFileSync(new URL("../spine-proto-manifest.json", import.meta.url), "utf8"),
    ) as { protoFiles: string[]; generatedExports: Record<string, string> };

    expect(Object.isFrozen(projectManagementProtoModule)).toBe(true);
    expect(projectManagementProtoModule.name).toBe(
      "@spine-event-engine/example-project-management",
    );
    expect(projectManagementProtoModule.dependencies).toHaveLength(1);
    expect(Object.keys(manifest.generatedExports)).toEqual(manifest.protoFiles);
    expect(existsSync(join(packageRoot.pathname, "generated/spine/options_pb.ts"))).toBe(false);
    expect(existsSync(join(packageRoot.pathname, "dist/generated/proto-module.js"))).toBe(true);
  });
});
