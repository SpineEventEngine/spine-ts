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

import { create, type Message } from "@bufbuild/protobuf";
import { timestampDate, timestampFromDate, type Timestamp } from "@bufbuild/protobuf/wkt";
import { createHash } from "node:crypto";
import {
  BetterAuthAccountRecordSchema as AccountSchema,
  BetterAuthSessionRecordSchema as SessionSchema,
  BetterAuthUserRecordSchema as UserSchema,
  BetterAuthVerificationRecordSchema as VerificationSchema,
} from "@spine-event-engine/proto/auth";

import type { BetterAuthModel } from "./persistent-store.js";

/**
 * Exact native field layouts supported by selected record families.
 */
const fields = {
  user: {
    scalar: ["id", "name", "email", "emailVerified", "image"],
    date: ["createdAt", "updatedAt"],
    required: ["id", "name", "email", "emailVerified", "createdAt", "updatedAt"],
  },
  account: {
    scalar: ["id", "userId", "accountId", "providerId", "password"],
    date: ["createdAt", "updatedAt"],
    required: ["id", "userId", "accountId", "providerId", "createdAt", "updatedAt"],
  },
  session: {
    scalar: ["id", "userId", "ipAddress", "userAgent"],
    date: ["expiresAt", "createdAt", "updatedAt"],
    required: ["id", "userId", "expiresAt", "createdAt", "updatedAt"],
  },
  verification: {
    scalar: ["id", "identifier", "value"],
    date: ["expiresAt", "createdAt", "updatedAt"],
    required: ["id", "identifier", "value", "expiresAt", "createdAt", "updatedAt"],
  },
} as const;

/**
 * Pinned native Account schema fields omitted from this selected profile.
 */
const unusedAccountFields = [
  "accessToken",
  "refreshToken",
  "idToken",
  "scope",
  "accessTokenExpiresAt",
  "refreshTokenExpiresAt",
] as const;

/**
 * Validates and converts selected native rows without losing optional field presence.
 */
export const BetterAuthRecords: Readonly<{
  encode(model: BetterAuthModel, data: Record<string, unknown>): Message;
  decode(model: BetterAuthModel, record: Message): Record<string, unknown>;
  key(model: BetterAuthModel, data: Record<string, unknown>): string;
  indexKey(value: string): Uint8Array;
  fields(model: BetterAuthModel): readonly string[];
  queryFields(model: BetterAuthModel): readonly string[];
}> = Object.freeze({
  /**
   * Converts a complete native row into its domain record.
   *
   * @param model Selected native record family.
   * @param data Native row with Date values.
   * @returns Domain-correct Protobuf record.
   */
  encode(model: BetterAuthModel, data: Record<string, unknown>): Message {
    CodecValues.validateFields(model, data);
    const value: Record<string, unknown> = {};
    for (const name of fields[model].scalar)
      if (data[name] !== undefined && data[name] !== null) value[name] = data[name];
    for (const name of fields[model].date)
      if (data[name] !== undefined && data[name] !== null)
        value[name] = CodecValues.exactTimestamp(data[name]);
    switch (model) {
      case "user":
        return create(UserSchema, value);
      case "account":
        return create(AccountSchema, value);
      case "session":
        return create(SessionSchema, value);
      case "verification":
        return create(VerificationSchema, value);
    }
  },

  /**
   * Converts a selected stored record into a detached native row.
   *
   * @param model Selected record family.
   * @param record Stored domain message.
   * @returns Native row with exact millisecond Dates.
   */
  decode(model: BetterAuthModel, record: Message): Record<string, unknown> {
    const source = record as unknown as Record<string, unknown>;
    const value: Record<string, unknown> = {};
    for (const name of fields[model].scalar)
      if (source[name] !== undefined) value[name] = source[name];
    for (const name of fields[model].date)
      if (source[name] !== undefined) value[name] = CodecValues.exactDate(source[name]);
    if (model === "session") value.token = source.id;
    return value;
  },

  /**
   * Derives one collision-resistant storage slot from immutable native identity.
   *
   * @param model Selected record family.
   * @param data Complete native row.
   * @returns Canonical unambiguous storage slot.
   */
  key(model: BetterAuthModel, data: Record<string, unknown>): string {
    if (model === "session") return CodecValues.requiredString(data.token, "session token");
    if (model === "account")
      return CodecValues.digest("account", [
        CodecValues.requiredString(data.providerId, "provider ID"),
        CodecValues.requiredString(data.accountId, "account ID"),
      ]);
    if (model === "verification")
      return CodecValues.digest("verification", [
        CodecValues.requiredString(data.identifier, "verification identifier"),
      ]);
    return CodecValues.requiredString(data.id, "user ID");
  },

  /**
   * Encodes a string lookup key for portable fixed-width provider indexes.
   *
   * Full native values are rechecked after index selection.
   *
   * @param value Native lookup value.
   * @returns Thirty-two digest bytes.
   */
  indexKey(value: string): Uint8Array {
    return createHash("sha256").update(value).digest();
  },

  /**
   * Lists fields admitted by the selected native model.
   *
   * @param model Selected model.
   * @returns Immutable admitted field names.
   */
  fields(model: BetterAuthModel): readonly string[] {
    return [
      ...fields[model].scalar,
      ...fields[model].date,
      ...(model === "account" ? unusedAccountFields : []),
      ...(model === "session" ? ["token"] : []),
    ];
  },

  /**
   * Lists persisted fields admitted in native predicates, excluding schema-only artifacts.
   *
   * @param model Selected native model.
   * @returns Queryable persisted field names.
   */
  queryFields(model: BetterAuthModel): readonly string[] {
    return [
      ...fields[model].scalar,
      ...fields[model].date,
      ...(model === "session" ? ["token"] : []),
    ];
  },
});

/**
 * Validates selected native values and exact Date conversions.
 */
const CodecValues = Object.freeze({
  /**
   * Validates native fields and required record completeness.
   *
   * @param model Selected model.
   * @param data Native row.
   */
  validateFields(model: BetterAuthModel, data: Record<string, unknown>): void {
    const admitted = BetterAuthRecords.fields(model);
    for (const field of Object.keys(data))
      if (!admitted.includes(field)) throw new TypeError(`Unsupported ${model} field: ${field}`);
    if (model === "account")
      for (const field of unusedAccountFields)
        if (data[field] !== undefined && data[field] !== null)
          throw new TypeError(`Unsupported selected Account value: ${field}.`);
    for (const field of fields[model].required)
      if (data[field] === undefined || data[field] === null || data[field] === "")
        throw new TypeError(`${model} requires ${field}.`);
    for (const field of fields[model].scalar) {
      const value = data[field];
      if (value === undefined || value === null) continue;
      const expected = model === "user" && field === "emailVerified" ? "boolean" : "string";
      if (typeof value !== expected)
        throw new TypeError(`${model}.${field} must be a ${expected}.`);
    }
    if (model === "session" && data.token !== undefined && typeof data.token !== "string")
      throw new TypeError("session.token must be a string.");
  },

  /**
   * Validates one required immutable string identity component.
   *
   * @param value Candidate identity.
   * @param label Domain label for rejection.
   * @returns Nonempty identity.
   */
  requiredString(value: unknown, label: string): string {
    if (typeof value !== "string" || value.length === 0)
      throw new TypeError(`Better Auth ${label} must be a nonempty string.`);
    return value;
  },

  /**
   * Builds a purpose-prefixed unambiguous digest of identity components.
   *
   * @param purpose Stable identity purpose.
   * @param parts Immutable identity components.
   * @returns Stable storage slot.
   */
  digest(purpose: string, parts: readonly string[]): string {
    return `${purpose}_${createHash("sha256").update(JSON.stringify(parts)).digest("base64url")}`;
  },

  /**
   * Converts a valid native Date without truncation beyond its millisecond domain.
   *
   * @param value Candidate native Date.
   * @returns Exact Protobuf Timestamp.
   */
  exactTimestamp(value: unknown): Timestamp {
    if (!(value instanceof Date) || !Number.isFinite(value.getTime()))
      throw new TypeError("Better Auth date must be a valid Date.");
    return timestampFromDate(value);
  },

  /**
   * Converts a stored exact millisecond Timestamp to a native Date.
   *
   * @param value Candidate stored Timestamp.
   * @returns Detached native Date.
   */
  exactDate(value: unknown): Date {
    const timestamp = value as Timestamp;
    if (timestamp.nanos % 1_000_000 !== 0)
      throw new RangeError("Stored Better Auth date has submillisecond precision.");
    const date = timestampDate(timestamp);
    if (!Number.isFinite(date.getTime()) || timestampFromDate(date).seconds !== timestamp.seconds)
      throw new RangeError("Stored Better Auth date is outside the native Date range.");
    return date;
  },
});
