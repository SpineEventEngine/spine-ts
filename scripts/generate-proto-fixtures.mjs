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

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse, stringify } from "yaml";

/**
 * Routes internal fixture descriptors and strict queries to separate Buf invocations.
 *
 * @param fixture The internal fixture target, either core or server.
 * @returns A subprocess runner for the existing model generation transaction.
 */
export function fixtureRunner(fixture) {
  if (fixture !== "core" && fixture !== "server") throw new TypeError("Unknown fixture target");
  return (command, args, options) => {
    if (args[0] !== "generate" || args[1] !== "--template" || args[2] !== "buf.gen.yaml")
      return spawnSync(command, args, options);
    const template = parse(readFileSync(join(options.cwd, "buf.gen.yaml"), "utf8"));
    const plugins = template?.plugins;
    if (!Array.isArray(plugins)) throw new TypeError("Fixture Buf template lacks plugins");
    const queries = plugins.filter((plugin) =>
      String(plugin.local).includes("entity-query-generator"),
    );
    if (queries.length !== 1) throw new TypeError("Fixture Buf template requires one query plugin");
    const base = join(options.cwd, "buf.fixtures.base.yaml");
    writeFileSync(
      base,
      stringify({ ...template, plugins: plugins.filter((p) => p !== queries[0]) }),
    );
    const generated = spawnSync(
      command,
      ["generate", "--template", base, ...args.slice(3)],
      options,
    );
    if (generated.status !== 0 || generated.signal !== null || generated.error !== undefined)
      return generated;
    if (fixture === "core") return generated;
    const query = join(options.cwd, "buf.fixtures.query.yaml");
    writeFileSync(query, stringify({ ...template, plugins: queries }));
    const paths = [];
    for (let index = 3; index < args.length; index += 2) {
      if (args[index] !== "--path" || args[index + 1] === undefined)
        throw new TypeError("Unexpected fixture Buf path arguments");
      if (args[index + 1] !== "entity-metadata/invalid-column.proto")
        paths.push("--path", args[index + 1]);
    }
    return paths.length === 0
      ? generated
      : spawnSync(command, ["generate", "--template", query, ...paths], options);
  };
}

/**
 * Executes staged internal fixture generation through the selected bootstrap executable.
 *
 * @param executable Compiled bootstrap CLI path.
 * @param stagedRoot Temporary fixture package root.
 * @param livePackageRoot Source fixture package root.
 * @param fixture Exact internal fixture target identifier.
 * @returns Completion of the model generation transaction.
 */
export async function generateProtoFixtures(executable, stagedRoot, livePackageRoot, fixture) {
  const generator = join(dirname(executable), "../generation/generator.js");
  const { ProtoGeneration } = await import(pathToFileURL(generator).href);
  ProtoGeneration.generate(stagedRoot, { livePackageRoot, runProcess: fixtureRunner(fixture) });
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [executable, stagedRoot, livePackageRoot, fixture] = process.argv.slice(2);
  if ([executable, stagedRoot, livePackageRoot, fixture].some((value) => value === undefined))
    throw new TypeError("Expected executable, staged root, live package root, and fixture target");
  await generateProtoFixtures(executable, stagedRoot, livePackageRoot, fixture);
}
