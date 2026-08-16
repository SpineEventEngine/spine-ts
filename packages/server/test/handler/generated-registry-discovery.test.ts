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

import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { fromBinary, toBinary, type Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { fileDesc, messageDesc } from "@bufbuild/protobuf/codegenv2";
import { FileDescriptorProtoSchema, FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";
import { CommandSchema, EventSchema, file_spine_options } from "@spine-event-engine/proto";
import { describe, expect, it } from "vitest";
import { serverEntityMetadataTestFixtures } from "../../test-fixtures/entity-metadata-fixtures.js";

import {
  GeneratedRegistryDiscovery,
  GeneratedRegistryDiscoveryError,
} from "../../src/handler/generated-registry-discovery.js";
import { type GeneratedHandlerRegistry } from "../../src/handler/generated-handler-registry.js";
import { HandlerRegistryIngestionError } from "../../src/handler/generated-handler-registry.js";
import { HandlerMetadataRegistry } from "../../src/handler/handler-metadata.js";

type ProjectionState = Message<"ProjectionState"> & {
  id: string;
  name: string;
  priority: number;
};

class DiscoveredProjection {
  assignCreate(command: Message<"spine.core.Command">): void {
    void command;
  }
}

function createFixtureFileDescriptor(descriptorSetBase64: string, imports = [file_spine_options]) {
  const descriptorSet = fromBinary(
    FileDescriptorSetSchema,
    Buffer.from(descriptorSetBase64, "base64"),
  );
  const descriptor = descriptorSet.file[0];

  if (descriptor === undefined) {
    throw new Error("Generated registry discovery fixture descriptor set is empty.");
  }

  return fileDesc(
    Buffer.from(toBinary(FileDescriptorProtoSchema, descriptor)).toString("base64"),
    imports,
  );
}

const fileEntityMetadataFixture = createFixtureFileDescriptor(
  serverEntityMetadataTestFixtures.main.descriptorSetBase64,
);
const ProjectionStateSchema = messageDesc(
  fileEntityMetadataFixture,
  0,
) as GenMessage<ProjectionState>;

describe("generated registry discovery", () => {
  it("loads generated registries from explicit file URLs", async () => {
    const module = createModuleFixture(
      "generated-registry.js",
      "export const generatedHandlerRegistry = { version: 3, entities: [] };\n",
    );
    const discovery = new GeneratedRegistryDiscovery();

    const registries = await discovery.load({ modules: [module.moduleUrl] });

    expect(registries).toEqual([{ version: 3, entities: [] }]);
  });

  it("loads generated registries with a custom export and cache-busting token", async () => {
    const module = createModuleFixture(
      "custom-export.js",
      "export const customRegistry = { version: 3, entities: [] };\n",
    );
    const discovery = new GeneratedRegistryDiscovery();

    const registries = await discovery.load({
      modules: [module.modulePath],
      exportName: "customRegistry",
      cacheBust: "coverage",
    });

    expect(registries).toEqual([{ version: 3, entities: [] }]);
  });

  it("loads the conventional generated registry module from a package root path", async () => {
    const packageRoot = createPackageFixture();
    const modulePath = GeneratedRegistryDiscovery.conventionalModulePath(packageRoot);
    const discovery = new GeneratedRegistryDiscovery();

    writeFileSync(
      modulePath,
      "export const generatedHandlerRegistry = { version: 3, entities: [] };\n",
      "utf8",
    );

    const registries = await discovery.load({ modules: [modulePath] });

    expect(registries).toEqual([{ version: 3, entities: [] }]);
    expect(GeneratedRegistryDiscovery.conventionalModuleUrl(packageRoot).href).toBe(
      pathToFileURL(modulePath).href,
    );
  });

  it("rejects modules that omit the conventional generated registry export", async () => {
    const module = createModuleFixture("missing-export.js", "export const nope = {};\n");
    const discovery = new GeneratedRegistryDiscovery();

    await expect(discovery.load({ modules: [module.modulePath] })).rejects.toMatchObject({
      code: "MISSING_REGISTRY_EXPORT",
      moduleId: pathToFileURL(module.modulePath).href,
    });
  });

  it("rejects modules whose exported registry has the wrong top-level shape", async () => {
    const module = createModuleFixture(
      "invalid-registry.js",
      'export const generatedHandlerRegistry = { version: "1", entities: [] };\n',
    );
    const discovery = new GeneratedRegistryDiscovery();

    await expect(discovery.load({ modules: [module.modulePath] })).rejects.toMatchObject({
      code: "INVALID_REGISTRY_MODULE",
      moduleId: pathToFileURL(module.modulePath).href,
    });
  });

  it("rejects modules whose exported registry uses an unsupported version", async () => {
    const module = createModuleFixture(
      "unsupported-version.js",
      "export const generatedHandlerRegistry = { version: 2, entities: [] };\n",
    );
    const discovery = new GeneratedRegistryDiscovery();

    await expect(discovery.load({ modules: [module.modulePath] })).rejects.toMatchObject({
      code: "INVALID_REGISTRY_MODULE",
      moduleId: pathToFileURL(module.modulePath).href,
    });
  });

  it("reports deterministic import failures for missing generated registry modules", async () => {
    const missingRoot = mkdtempSync(join(tempRoot(), "spine-generated-registry-missing-"));
    const missingModule = join(missingRoot, "generated-handler-registry.js");
    const discovery = new GeneratedRegistryDiscovery();

    await expect(discovery.load({ modules: [missingModule] })).rejects.toMatchObject({
      code: "MODULE_IMPORT_FAILED",
      moduleId: pathToFileURL(missingModule).href,
    });
  });

  it("rejects data module URLs without importing them", async () => {
    const slot = `__spineBlockedDataModule_${Math.random().toString(36).slice(2)}`;
    const source = [
      `globalThis[${JSON.stringify(slot)}] = true;`,
      "export const generatedHandlerRegistry = { version: 3, entities: [] };",
    ].join(" ");
    const moduleUrl = new URL(`data:text/javascript,${encodeURIComponent(source)}`);
    const discovery = new GeneratedRegistryDiscovery();

    await expect(discovery.load({ modules: [moduleUrl] })).rejects.toMatchObject({
      code: "UNSUPPORTED_MODULE_SCHEME",
      moduleId: moduleUrl.href,
    });
    expect((globalThis as Record<string, unknown>)[slot]).toBeUndefined();
  });

  it("rejects file URL query aliases before importing them", async () => {
    const module = createModuleFixture(
      "query-alias.js",
      "export const generatedHandlerRegistry = { version: 3, entities: [] };\n",
    );
    const moduleUrl = new URL(module.moduleUrl.href);
    const discovery = new GeneratedRegistryDiscovery();

    moduleUrl.search = "v=1";

    await expect(discovery.load({ modules: [moduleUrl] })).rejects.toMatchObject({
      code: "INVALID_MODULE_REF",
      moduleId: moduleUrl.href,
    });
  });

  it("rejects file URL hash aliases before importing them", async () => {
    const module = createModuleFixture(
      "hash-alias.js",
      "export const generatedHandlerRegistry = { version: 3, entities: [] };\n",
    );
    const moduleUrl = new URL(module.moduleUrl.href);
    const discovery = new GeneratedRegistryDiscovery();

    moduleUrl.hash = "generated";

    await expect(discovery.load({ modules: [moduleUrl] })).rejects.toMatchObject({
      code: "INVALID_MODULE_REF",
      moduleId: moduleUrl.href,
    });
  });

  it("rejects node module URLs before module shape validation", async () => {
    const discovery = new GeneratedRegistryDiscovery();

    await expect(discovery.load({ modules: ["node:fs"] })).rejects.toMatchObject({
      code: "UNSUPPORTED_MODULE_SCHEME",
      moduleId: "node:fs",
    });
  });

  it("wraps malformed URL-like module refs in discovery errors", async () => {
    const discovery = new GeneratedRegistryDiscovery();

    await expect(discovery.load({ modules: ["http://%"] })).rejects.toMatchObject({
      code: "INVALID_MODULE_REF",
      moduleId: "http://%",
    });
  });

  it("treats Windows drive-letter module refs as filesystem paths", async () => {
    const windowsPath = "C:\\spine\\generated-handler-registry.js";
    const discovery = new GeneratedRegistryDiscovery();

    await expect(discovery.load({ modules: [windowsPath] })).rejects.toMatchObject({
      code: "MODULE_IMPORT_FAILED",
      moduleId: pathToFileURL(resolve(windowsPath)).href,
    });
  });

  it("rejects duplicate normalized generated registry module refs", async () => {
    const module = createModuleFixture(
      "duplicate-registry.js",
      "export const generatedHandlerRegistry = { version: 3, entities: [] };\n",
    );
    const discovery = new GeneratedRegistryDiscovery();

    await expect(
      discovery.load({ modules: [module.modulePath, module.moduleUrl] }),
    ).rejects.toMatchObject({
      code: "DUPLICATE_REGISTRY_MODULE",
      moduleId: module.moduleUrl.href,
    });
  });

  it("registers discovered generated registries into a new handler metadata registry", async () => {
    const module = createRegistryValueModule({
      version: 3,
      entities: [
        {
          entityType: DiscoveredProjection,
          stateSchema: ProjectionStateSchema,
          handlers: [
            {
              kind: "command-assignment",
              methodName: "assignCreate",
              signalSchema: CommandSchema,
              emittedSchemas: [EventSchema],
              parameterCount: 1,
              origin: "domestic",
            },
          ],
        },
      ],
    });
    const discovery = new GeneratedRegistryDiscovery();

    try {
      const registry = await discovery.register({ modules: [module.modulePath] });

      expect(registry).toBeInstanceOf(HandlerMetadataRegistry);
      expect(registry.findCommandAssignment("spine.core.Command")?.entityType).toBe(
        DiscoveredProjection,
      );
      expect(registry.listEntityHandlers()).toHaveLength(1);
    } finally {
      module.cleanup();
    }
  });

  it("wraps ingestion failures in a deterministic discovery error", async () => {
    const module = createRegistryValueModule({
      version: 3,
      entities: [
        {
          entityType: DiscoveredProjection,
          stateSchema: {},
          handlers: [],
        },
      ],
    } as never);
    const discovery = new GeneratedRegistryDiscovery();

    try {
      await expect(discovery.register({ modules: [module.modulePath] })).rejects.toSatisfy(
        (error: unknown) =>
          error instanceof GeneratedRegistryDiscoveryError &&
          error.code === "REGISTRY_INGESTION_FAILED" &&
          error.cause instanceof HandlerRegistryIngestionError,
      );
    } finally {
      module.cleanup();
    }
  });
});

function createRegistryValueModule(registry: GeneratedHandlerRegistry): {
  readonly modulePath: string;
  readonly cleanup: () => void;
} {
  const slot = `__spineGeneratedRegistry_${Math.random().toString(36).slice(2)}`;
  const values = globalThis as Record<string, unknown>;

  values[slot] = registry;
  const module = createModuleFixture(
    `${slot}.js`,
    `export const generatedHandlerRegistry = globalThis[${JSON.stringify(slot)}];\n`,
  );

  return {
    modulePath: module.modulePath,
    cleanup: () => {
      values[slot] = undefined;
    },
  };
}

function createPackageFixture(): string {
  const packageRoot = mkdtempSync(join(tempRoot(), "spine-generated-registry-package-"));

  mkdirSync(join(packageRoot, "generated/handler"), { recursive: true });

  return packageRoot;
}

function createModuleFixture(
  fileName: string,
  source: string,
): {
  readonly modulePath: string;
  readonly moduleUrl: URL;
} {
  const root = mkdtempSync(join(tempRoot(), "spine-generated-registry-discovery-"));
  const modulePath = join(root, fileName);

  writeFileSync(modulePath, source, "utf8");

  return {
    modulePath,
    moduleUrl: pathToFileURL(modulePath),
  };
}

function tempRoot(): string {
  return tmpdir();
}
