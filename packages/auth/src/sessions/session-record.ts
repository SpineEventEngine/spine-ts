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

import { clone, create } from "@bufbuild/protobuf";
import { TimestampSchema, type Timestamp } from "@bufbuild/protobuf/wkt";
import {
  AuthenticatedPrincipalSchema,
  PrincipalAttributesSchema,
  type AuthenticatedPrincipal as ProtoPrincipal,
  type OpaqueSessionRecord,
} from "@spine-event-engine/proto/auth";

import type { AuthenticatedPrincipal } from "../index.js";

/**
 * Domain conversion and exact time ordering for opaque session records.
 */
export const SessionRecords: Readonly<{
  deadline(value: Timestamp): Timestamp;
  compare(left: Timestamp, right: Timestamp): number;
  orderKey(value: Timestamp): Uint8Array;
  principal(principal: AuthenticatedPrincipal): ProtoPrincipal;
  publicPrincipal(record: OpaqueSessionRecord): AuthenticatedPrincipal;
  expiry(record: OpaqueSessionRecord): Timestamp;
}> = Object.freeze({
  /**
   * Validates an exact Protobuf deadline.
   *
   * @param value Candidate deadline.
   * @returns Detached validated deadline.
   */
  deadline(value: Timestamp): Timestamp {
    if (
      value.seconds < -62_135_596_800n ||
      value.seconds > 253_402_300_799n ||
      !Number.isInteger(value.nanos) ||
      value.nanos < 0 ||
      value.nanos >= 1_000_000_000
    )
      throw new RangeError("Session deadline is outside the Protobuf Timestamp range.");
    return clone(TimestampSchema, value);
  },

  /**
   * Compares exact deadlines without millisecond truncation.
   *
   * @param left First deadline.
   * @param right Second deadline.
   * @returns Negative, zero, or positive order.
   */
  compare(left: Timestamp, right: Timestamp): number {
    if (left.seconds < right.seconds) return -1;
    if (left.seconds > right.seconds) return 1;
    return left.nanos - right.nanos;
  },

  /**
   * Encodes a complete deadline for unsigned byte ordering.
   *
   * @param value Exact deadline.
   * @returns Twelve ordered bytes.
   */
  orderKey(value: Timestamp): Uint8Array {
    const deadline = SessionRecords.deadline(value);
    const bytes = Buffer.alloc(12);
    bytes.writeBigUInt64BE(BigInt.asUintN(64, deadline.seconds) ^ 0x8000_0000_0000_0000n, 0);
    bytes.writeUInt32BE(deadline.nanos, 8);
    return bytes;
  },

  /**
   * Copies a public principal into the domain message with attributes presence.
   *
   * @param principal Authenticated identity.
   * @returns Complete Protobuf identity.
   */
  principal(principal: AuthenticatedPrincipal): ProtoPrincipal {
    if (typeof principal.id !== "string") throw new TypeError("principal.id must be a string.");
    if (principal.attributes === undefined)
      return create(AuthenticatedPrincipalSchema, { id: principal.id });
    const values = Object.fromEntries(Object.entries(principal.attributes));
    if (Object.values(values).some((value) => typeof value !== "string"))
      throw new TypeError("Principal attributes must be strings.");
    return create(AuthenticatedPrincipalSchema, {
      id: principal.id,
      attributes: create(PrincipalAttributesSchema, { values }),
    });
  },

  /**
   * Copies a stored identity to the public principal shape.
   *
   * @param record Complete session record.
   * @returns Detached public identity.
   */
  publicPrincipal(record: OpaqueSessionRecord): AuthenticatedPrincipal {
    const principal = record.principal;
    if (principal === undefined) throw new Error("Stored session has no principal.");
    const attributes = principal.attributes;
    return Object.freeze(
      attributes === undefined
        ? { id: principal.id }
        : { id: principal.id, attributes: Object.freeze({ ...attributes.values }) },
    );
  },

  /**
   * Reads the required exact deadline from a stored session.
   *
   * @param record Complete session record.
   * @returns Validated deadline.
   */
  expiry(record: OpaqueSessionRecord): Timestamp {
    if (record.whenExpires === undefined) throw new Error("Stored session has no expiry.");
    return SessionRecords.deadline(record.whenExpires);
  },
});
