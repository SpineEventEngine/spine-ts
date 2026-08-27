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
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const repoRoot = new URL("..", import.meta.url).pathname;
const checkerPath = new URL("./check-api-docs.mjs", import.meta.url).pathname;

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

describe("storage API documentation inventory", () => {
  it("documents the provider entry point separately from the storage root", () => {
    const typedoc = JSON.parse(readFileSync(resolve(repoRoot, "typedoc.json"), "utf8"));

    expect(typedoc.entryPoints).toContain("packages/storage/src/provider.ts");
  });

  it("isolates the checker TypeDoc output from docs/api/reference", () => {
    const checker = readFileSync(checkerPath, "utf8");

    expect(checker).toContain('const referencePath = join(outputDir, "reference");');
    expect(checker).toContain('"--out", referencePath');
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
