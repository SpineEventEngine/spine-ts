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
import type { Timestamp } from "@bufbuild/protobuf/wkt";
import type { RecordQuery } from "./record-query.js";
import type { RecordEntry, RecordStorage } from "./record-storage.js";

/**
 * A record and its private provider token from the ordinary inbox page.
 *
 * @typeParam I Inbox record identifier.
 * @typeParam R Generated inbox record.
 */
export interface InboxRecordEntry<I, R extends Message> extends RecordEntry<I, R> {
  /**
   * Provider concurrency metadata carried only within local storage code.
   */
  readonly mutationToken?: unknown;
}

/**
 * Provider operations that complete an inbox ID without replacing its payload.
 *
 * @typeParam I Inbox record identifier.
 * @typeParam R Generated inbox record.
 */
export interface InboxRecordMutations<I, R extends Message> {
  /**
   * Marks the current ID delivered, preserving its first retention deadline.
   *
   * @param id Complete storage ID.
   * @param deadline Proposed first completion deadline.
   * @param token Private concurrency metadata from an ordinary page, when available.
   * @returns The first stored deadline, or undefined when the ID cannot be acknowledged.
   */
  markInboxDelivered(id: I, deadline: Timestamp, token?: unknown): Promise<Timestamp | undefined>;

  /**
   * Deletes an inbox ID only while its current status is pending.
   *
   * @param id Complete storage ID.
   * @param token Private concurrency metadata from an ordinary page, when available.
   * @returns True when the ID was removed or is absent; false when it is delivered.
   */
  removePendingInbox(id: I, token?: unknown): Promise<boolean>;

  /**
   * Reads an inbox page with private metadata needed for a conditional mutation.
   *
   * @param query Provider-executable inbox query.
   * @returns Ordered entries and optional private mutation tokens.
   */
  queryInboxEntries?(query: RecordQuery<I>): Promise<readonly InboxRecordEntry<I, R>[]>;

  /**
   * Deletes expired delivered messages in one provider predicate operation.
   *
   * @param shard Selected shard.
   * @param now Inclusive retention cutoff.
   * @returns Whether the provider applied the cleanup predicate.
   */
  removeExpiredInbox?(
    shard: { readonly index: number; readonly ofTotal: number },
    now: Timestamp,
  ): Promise<boolean>;
}

/**
 * Checks provider record handles for specialized inbox mutations.
 */
export interface InboxRecordCapabilityApi {
  /**
   * Checks whether a record handle supports ID-based inbox acknowledgement.
   *
   * @typeParam I Inbox record identifier.
   * @typeParam R Generated inbox record.
   * @param storage Record handle returned by the configured factory.
   * @returns Whether the provider exposes inbox mutations.
   */
  hasMutations<I, R extends Message>(
    storage: RecordStorage<I, R>,
  ): storage is RecordStorage<I, R> & InboxRecordMutations<I, R>;
}

/**
 * Detects the provider's specialized inbox mutation capability.
 */
export const InboxRecordStorageCapabilities: Readonly<InboxRecordCapabilityApi> = Object.freeze({
  /**
   * Checks whether a record handle supports ID-based inbox acknowledgement.
   *
   * @typeParam I Inbox record identifier.
   * @typeParam R Generated inbox record.
   * @param storage Record handle returned by the configured factory.
   * @returns Whether the provider exposes inbox mutations.
   */
  hasMutations<I, R extends Message>(
    storage: RecordStorage<I, R>,
  ): storage is RecordStorage<I, R> & InboxRecordMutations<I, R> {
    return "markInboxDelivered" in storage && typeof storage.markInboxDelivered === "function";
  },
});
