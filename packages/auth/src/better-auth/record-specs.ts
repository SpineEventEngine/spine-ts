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

import {
  BetterAuthAccountRecordSchema as AccountSchema,
  BetterAuthSessionRecordSchema as SessionSchema,
  BetterAuthUserRecordSchema as UserSchema,
  BetterAuthVerificationRecordSchema as VerificationSchema,
  type BetterAuthAccountRecord,
  type BetterAuthSessionRecord,
  type BetterAuthUserRecord,
  type BetterAuthVerificationRecord,
} from "@spine-event-engine/proto/auth";
import {
  ColumnTypes,
  RecordColumn,
  RecordSpec,
  type StorageContext,
} from "@spine-event-engine/storage";
import type { Timestamp } from "@bufbuild/protobuf/wkt";

import { SessionRecords } from "../sessions/session-record.js";
import { BetterAuthRecords } from "./record-codec.js";

/**
 * Shared storage scope for selected native authentication records.
 */
export const context: StorageContext = {
  /**
   * Dedicated authentication storage scope.
   */
  name: "__AUTH_BETTER_AUTH__",

  /**
   * Selected Better Auth records do not depend on a tenant key.
   */
  multitenant: false,
};

/**
 * Physical layout of persisted native users and their email lookup.
 */
export const userSpec: RecordSpec<string, BetterAuthUserRecord> = new RecordSpec<
  string,
  BetterAuthUserRecord
>({
  recordType: UserSchema,
  idKind: "string",
  extractId: (record) => record.id,
  columns: [
    new RecordColumn("email_digest", ColumnTypes.fixedBytes(32), (record) =>
      BetterAuthRecords.indexKey(record.email),
    ),
  ],
  indexes: [{ name: "email", columns: ["email_digest", "id"] }],
});

/**
 * Physical layout of provider accounts and user lookup.
 */
export const accountSpec: RecordSpec<string, BetterAuthAccountRecord> = new RecordSpec<
  string,
  BetterAuthAccountRecord
>({
  recordType: AccountSchema,
  idKind: "string",
  extractId: (record) => record.id,
  columns: [
    new RecordColumn("user_digest", ColumnTypes.fixedBytes(32), (record) =>
      BetterAuthRecords.indexKey(record.userId),
    ),
    new RecordColumn("provider_digest", ColumnTypes.fixedBytes(32), (record) =>
      BetterAuthRecords.indexKey(record.providerId),
    ),
    new RecordColumn("subject_digest", ColumnTypes.fixedBytes(32), (record) =>
      BetterAuthRecords.indexKey(record.accountId),
    ),
  ],
  indexes: [
    { name: "user", columns: ["user_digest", "id"] },
    { name: "provider", columns: ["provider_digest", "id"] },
    { name: "subject", columns: ["subject_digest", "id"] },
  ],
});

/**
 * Physical layout of native sessions and indexed expiry maintenance.
 */
export const sessionSpec: RecordSpec<string, BetterAuthSessionRecord> = new RecordSpec<
  string,
  BetterAuthSessionRecord
>({
  recordType: SessionSchema,
  idKind: "string",
  extractId: (record) => record.id,
  columns: [
    new RecordColumn("user_digest", ColumnTypes.fixedBytes(32), (record) =>
      BetterAuthRecords.indexKey(record.userId),
    ),
    new RecordColumn("expires_order", ColumnTypes.fixedBytes(12), (record) =>
      PhysicalExpiry.order(record.expiresAt),
    ),
  ],
  indexes: [
    { name: "user", columns: ["user_digest", "id"] },
    { name: "expiry", columns: ["expires_order", "id"] },
  ],
});

/**
 * Physical layout of purpose-qualified singleton verifications.
 */
export const verificationSpec: RecordSpec<string, BetterAuthVerificationRecord> = new RecordSpec<
  string,
  BetterAuthVerificationRecord
>({
  recordType: VerificationSchema,
  idKind: "string",
  extractId: (record) => record.id,
  columns: [
    new RecordColumn("expires_order", ColumnTypes.fixedBytes(12), (record) =>
      PhysicalExpiry.order(record.expiresAt),
    ),
  ],
  indexes: [{ name: "expiry", columns: ["expires_order", "id"] }],
});

/**
 * Converts authoritative native expiry to its physical index key.
 */
const PhysicalExpiry = Object.freeze({
  /**
   * Encodes a required native expiry for a physical ascending index.
   *
   * @param expiry Required exact deadline.
   * @returns Twelve byte ordered key.
   */
  order(expiry: Timestamp | undefined): Uint8Array {
    if (expiry === undefined) throw new Error("Better Auth record requires an expiry.");
    return SessionRecords.orderKey(expiry);
  },
});
