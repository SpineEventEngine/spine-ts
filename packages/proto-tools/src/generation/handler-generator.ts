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

import { generateHandlerRegistry } from "./handler-codegen.js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ProtoConfig, ProtoManifest } from "../index.js";
import { generatedSource } from "./generated-source-policy.js";

/**
 * Generates application handler registries.
 */
export const HandlerGeneration: Readonly<{ generate(applicationRoot: string): void }> =
  Object.freeze({
    // prettier-ignore

    /**
     * Generates an application's conventional handler registry from its TypeScript project.
     *
     * @param applicationRoot The application package root.
     * @returns Nothing.
     */
    generate(applicationRoot: string): void {
      const config = existsSync(join(applicationRoot, "spine-proto.json"))
        ? ProtoConfig.read(applicationRoot)
        : undefined;
      const sources = config?.mode === "application"
        ? config.modelPackages.flatMap((modelPackage: string) => {
            const modelRoot = join(applicationRoot, "node_modules", modelPackage);
            const manifest = join(modelRoot, "spine-proto-manifest.json");
            if (existsSync(manifest)) return ProtoManifest.read(modelRoot).protoFiles;
            const module = join(modelRoot, "dist", "generated", "proto-module.js");
            return existsSync(module)
              ? [...readFileSync(module, "utf8").matchAll(/^ \* Source Proto: (.+)$/gmu)].map(
                  (match) => match[1] ?? "",
                )
              : [];
          })
        : [];
      if (sources.length === 0)
        throw new Error("spine-proto: handler generation requires model Proto provenance");
      generateHandlerRegistry(
        { appRoot: applicationRoot },
        {
          write(path, source) {
            writeFileSync(path, generatedSource(source, sources), "utf8");
          },
        },
      );
    },
  });
