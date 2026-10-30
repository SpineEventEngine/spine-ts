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

import { createRegistry } from "@bufbuild/protobuf";
import type { ProtoModule } from "../model/proto-module.js";

let roots: readonly ProtoModule[] = Object.freeze([]);

/**
 * Registers a generated module and its declared dependencies at startup.
 * A failed registration leaves the previous inventory available.
 */
const ProtoModuleInventory = Object.freeze({
  /**
   * Validates and adds a generated module atomically.
   *
   * @param module Module and dependency graph to register.
   * @returns The registered module.
   */
  register(module: ProtoModule): ProtoModule {
    if (roots.includes(module)) return module;
    const candidate = Object.freeze([...roots, module]);
    const modules = new Map<string, ProtoModule>();
    const schemas = new Map<string, ProtoModule["schemas"][number]>();
    const descriptorNames = new Map<object, string>();
    const visiting = new Set<ProtoModule>();
    const visited = new Set<ProtoModule>();
    const visit = (current: ProtoModule): void => {
      if (visiting.has(current))
        throw new Error(`Protobuf module dependency cycle: ${current.name}`);
      const earlier = modules.get(current.name);
      if (earlier !== undefined && earlier !== current)
        throw new Error(`Conflicting Protobuf module: ${current.name}`);
      if (visited.has(current)) return;
      modules.set(current.name, current);
      visiting.add(current);
      for (const dependency of current.dependencies) visit(dependency);
      for (const schema of current.schemas) {
        const prior = schemas.get(schema.typeName);
        if (prior !== undefined) throw new Error(`Conflicting Protobuf type: ${schema.typeName}`);
        const earlierName = descriptorNames.get(schema.proto);
        if (earlierName !== undefined)
          throw new Error(`Conflicting Protobuf descriptor: ${earlierName}`);
        schemas.set(schema.typeName, schema);
        descriptorNames.set(schema.proto, schema.typeName);
      }
      visiting.delete(current);
      visited.add(current);
    };
    for (const root of candidate) visit(root);
    createRegistry(...schemas.values());
    roots = candidate;
    return module;
  },

  /**
   * Reads the stable inventory snapshot.
   *
   * @returns Registered root modules.
   */
  snapshot(): readonly ProtoModule[] {
    return roots;
  },
});

/**
 * Registers a generated module at runtime.
 */
export const registerProtoModule: (module: ProtoModule) => ProtoModule =
  ProtoModuleInventory.register;

/**
 * Returns the stable registered root snapshot for descriptor composition.
 */
export const registeredProtoModules: () => readonly ProtoModule[] = ProtoModuleInventory.snapshot;
