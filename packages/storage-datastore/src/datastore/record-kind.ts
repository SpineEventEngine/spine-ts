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

import type { StorageGroup } from "@spine-event-engine/storage";
import { EventStoreGroups } from "@spine-event-engine/storage/provider";

/**
 * Resolves one Datastore record kind from the selected physical group.
 */
export const RecordKinds: Readonly<{
  of(sourceType: string, recordType: string, group?: StorageGroup): string;
}> = Object.freeze({
  of(sourceType: string, recordType: string, group?: StorageGroup): string {
    if (group === undefined) return sourceType;
    const suffix = recordType.split(".").at(-1) ?? "";
    return `${group.name}${EventStoreGroups.identity(group) === undefined ? "_" : "-"}${suffix}`;
  },
});
