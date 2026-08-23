/*
 * Copyright 2026, CodeMatters. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License
 * is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions and limitations under
 * the License.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import ts from "typescript";
import { afterAll, describe, expect, it } from "vitest";
import { runBoundedCommand } from "./snapshot-test-command-runner.mjs";

const repoRoot = new URL("..", import.meta.url).pathname;
const checkerPath = new URL("./check-api-docs.mjs", import.meta.url).pathname;
let generatedApiDocs;
let generatedApiDocsOutput;

const publishedSpiModules = [
  {
    documented: "packages/core/src/spi/subscription-lifecycle",
    source: "packages/core/src/spi/subscription-lifecycle.ts",
  },
  {
    documented: "packages/deployment/src/spi/backend-membership",
    source: "packages/deployment/src/spi/backend-membership.ts",
  },
  {
    documented: "packages/server/src/spi/handler-registry",
    source: "packages/server/src/spi/handler-registry.ts",
  },
  {
    documented: "packages/server/src/spi/delivery",
    source: "packages/server/src/spi/delivery.ts",
  },
];

const expectedStorageProviderExports = [
  "CleanupOperation",
  "DeliveryCleanupInput",
  "DeliveryCleanupStorage",
  "DeliveryCleanupStorageFactories",
  "DeliveryCleanupStorageFactory",
  "EntityCommitInput",
  "EntityCommitResult",
  "EntityCommitStorage",
  "EntityCommitStorageFactories",
  "EntityCommitStorageFactory",
  "EntityEventHistoryPort",
  "EntityHistoryConformance",
  "EntityHistoryConformanceAdapter",
  "EntityIdCodec",
  "EntityRecord",
  "EntityRecordStorage",
  "EntityStateHistoryPort",
  "EntityStorageConformance",
  "EntityStorageInput",
  "StorageQueryValues",
  "TenantBoundary",
  "TenantCatalog",
  "TenantCatalogProvider",
  "cleanupOperationActive",
  "disabledEventHistoryPort",
  "disabledStateHistoryPort",
  "eventHistorySpec",
  "eventStoreAccess",
  "eventStoreRecordSpec",
  "stateHistorySpec",
];

function moduleExports(path) {
  const program = ts.createProgram([path], {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    skipLibCheck: true,
    target: ts.ScriptTarget.ESNext,
  });
  const source = program.getSourceFile(path);
  const symbol =
    source === undefined ? undefined : program.getTypeChecker().getSymbolAtLocation(source);
  return symbol === undefined
    ? []
    : program
        .getTypeChecker()
        .getExportsOfModule(symbol)
        .map((value) => value.getName())
        .sort((left, right) => left.localeCompare(right));
}

function namedChild(value, name) {
  if (value === null || typeof value !== "object") return undefined;
  if (value.name === name) return value;
  return value.children
    ?.map((child) => namedChild(child, name))
    .find((child) => child !== undefined);
}

function generatedTypeDocModel() {
  if (generatedApiDocs === undefined) {
    generatedApiDocsOutput = mkdtempSync(join(tmpdir(), "spine-api-docs-test-"));
    const jsonPath = join(generatedApiDocsOutput, "api.json");
    try {
      runBoundedCommand(
        resolve(repoRoot, "node_modules/.bin/typedoc"),
        ["--options", "typedoc.json", "--json", jsonPath],
        repoRoot,
        60_000,
      );
      generatedApiDocs = JSON.parse(readFileSync(jsonPath, "utf8"));
    } catch (error) {
      rmSync(generatedApiDocsOutput, { force: true, recursive: true });
      generatedApiDocsOutput = undefined;
      throw error;
    }
  }

  return generatedApiDocs;
}

function documentedModuleExports(moduleName) {
  const module = namedChild(generatedTypeDocModel(), moduleName);
  return (module?.children ?? []).map((child) => child.name);
}

describe("storage API documentation inventory", () => {
  afterAll(() => {
    if (generatedApiDocsOutput !== undefined)
      rmSync(generatedApiDocsOutput, { force: true, recursive: true });
  });
  it("documents the provider entry point separately from the storage root", () => {
    const typedoc = JSON.parse(readFileSync(resolve(repoRoot, "typedoc.json"), "utf8"));

    expect(typedoc.entryPoints).toContain("packages/storage/src/provider.ts");
  });

  it("includes every published SPI subpath in TypeDoc", () => {
    const typedoc = JSON.parse(readFileSync(resolve(repoRoot, "typedoc.json"), "utf8"));

    expect(typedoc.entryPoints).toEqual(
      expect.arrayContaining([
        "packages/core/src/spi/subscription-lifecycle.ts",
        "packages/deployment/src/spi/backend-membership.ts",
        "packages/server/src/spi/handler-registry.ts",
        "packages/server/src/spi/delivery.ts",
      ]),
    );
  });

  it("keeps every published SPI TypeDoc page equal to its public source exports", () => {
    for (const spi of publishedSpiModules) {
      expect(documentedModuleExports(spi.documented).sort()).toEqual(
        moduleExports(resolve(repoRoot, spi.source)),
      );
    }
  }, 60_000);

  it("accepts published SPI documentation without classifying it as a package-root export", () => {
    const result = spawnSync(process.execPath, [checkerPath], {
      cwd: repoRoot,
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
  }, 60_000);

  it("lists EntityRecord directly on the provider TypeDoc page", () => {
    expect(documentedModuleExports("packages/storage/src/provider")).toContain("EntityRecord");
  }, 60_000);

  it("keeps tenant contracts in the provider module only", () => {
    const rootExports = moduleExports(resolve(repoRoot, "packages/storage/src/index.ts"));
    const providerExports = moduleExports(resolve(repoRoot, "packages/storage/src/provider.ts"));

    for (const name of ["TenantBoundary", "TenantCatalog", "TenantCatalogProvider"]) {
      expect(rootExports).not.toContain(name);
    }
    expect(providerExports).toEqual(
      [...expectedStorageProviderExports].sort((left, right) => left.localeCompare(right)),
    );
  });
});
