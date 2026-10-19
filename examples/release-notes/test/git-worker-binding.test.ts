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

import { expect, it } from "vitest";

import { GitWorkerBinding } from "../src/trusted/git-worker-binding.js";

it("accepts a schema-valid Git worker binding beyond the former 8 KiB ceiling", () => {
  const repository = `/tmp/${"nested/".repeat(1500)}release`;
  expect(
    GitWorkerBinding.parse(
      JSON.stringify({
        repository,
        gitExecutable: "/usr/bin/git",
        base: "a".repeat(40),
        target: "b".repeat(40),
        repositoryDevice: 1,
        repositoryInode: 2,
        catalogDigest: "c".repeat(64),
      }),
    ).repository,
  ).toBe(repository);
});

it("rejects a missing or malformed Git worker binding", () => {
  expect(() => GitWorkerBinding.parse(undefined)).toThrow("Release Git worker binding is invalid.");
  expect(() => GitWorkerBinding.parse("{}")).toThrow();
});
