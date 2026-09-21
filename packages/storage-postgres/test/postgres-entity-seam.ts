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

import type { Message } from "@bufbuild/protobuf";
import type { EntityStorageInput } from "@spine-event-engine/storage/provider";

import type { PostgresEntityStorage } from "../src/postgres/entity-history.js";
import type { PostgresStorageFactory } from "../src/postgres/storage-factory.js";

interface EntityStorageSeam {
  createEntityStorage<I, S extends Message>(
    input: EntityStorageInput<I, S>,
  ): PostgresEntityStorage<I, S>;
}

/** Invokes the private runtime Entity-storage seam through its structural contract. */
export function entityStorage<I, S extends Message>(
  factory: PostgresStorageFactory,
  input: EntityStorageInput<I, S>,
): PostgresEntityStorage<I, S> {
  return (factory as unknown as EntityStorageSeam).createEntityStorage(input);
}
