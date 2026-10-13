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

import { z } from "zod/v4";

interface GitWorkerBindingValue {
  repository: string;
  gitExecutable: string;
  base: string;
  target: string;
  repositoryDevice: number;
  repositoryInode: number;
  catalogDigest: string;
}

const bindingSchema: z.ZodType<GitWorkerBindingValue> = z
  .object({
    repository: z.string().min(1),
    gitExecutable: z.string().min(1),
    base: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/),
    target: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/),
    repositoryDevice: z.number().int().nonnegative(),
    repositoryInode: z.number().int().nonnegative(),
    catalogDigest: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

/**
 * Validates the exact pinned Git comparison passed to the fixed worker.
 */
export const GitWorkerBinding = {
  /**
   * Parses the serialized worker environment binding.
   *
   * @param encoded Serialized trusted binding from the worker environment.
   * @returns Schema-validated comparison binding.
   */
  parse(encoded: string | undefined): GitWorkerBindingValue {
    if (!encoded) throw new Error("Release Git worker binding is invalid.");
    return bindingSchema.parse(JSON.parse(encoded) as unknown);
  },
};
