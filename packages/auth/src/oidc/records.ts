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

import { createHash } from "node:crypto";
import type { Timestamp } from "@bufbuild/protobuf/wkt";
import type { OidcLoginGrant, OidcLoginTransaction } from "@spine-event-engine/proto/auth";

import { SessionRecords } from "../sessions/session-record.js";
import type { AuthenticatedPrincipal } from "../index.js";

/**
 * Exact identity and expiry helpers for component login records.
 */
export const OidcFlowKeys: Readonly<{
  digest(flowId: string, value: string): string;
  lowerBound(flowId: string): Uint8Array;
  upperBound(flowId: string, cutoff: Timestamp): Uint8Array;
  expiry(record: OidcLoginTransaction | OidcLoginGrant): Timestamp;
  orderKey(record: OidcLoginTransaction | OidcLoginGrant): Uint8Array;
  principal(record: OidcLoginGrant): AuthenticatedPrincipal;
}> = Object.freeze({
  /**
   * Qualifies a one-use browser value by its configured flow before hashing.
   *
   * @param flowId Application-selected flow identity.
   * @param value Random state or grant value.
   * @returns SHA-256 digest used only as the record slot.
   */
  digest(flowId: string, value: string): string {
    if (!flowId || !value) throw new TypeError("OIDC flow and lookup value must be nonempty.");
    return createHash("sha256")
      .update(JSON.stringify([flowId, value]))
      .digest("hex");
  },

  /**
   * Starts the indexed expiry range for one flow.
   *
   * @param flowId Application-selected flow identity.
   * @returns Digest prefix followed by the least twelve-byte deadline.
   */
  lowerBound(flowId: string): Uint8Array {
    return Buffer.concat([createHash("sha256").update(flowId).digest(), Buffer.alloc(12)]);
  },

  /**
   * Ends the indexed expiry range at one exact deadline.
   *
   * @param flowId Application-selected flow identity.
   * @param cutoff Trusted maximum deadline.
   * @returns Digest prefix followed by the encoded cutoff.
   */
  upperBound(flowId: string, cutoff: Timestamp): Uint8Array {
    return Buffer.concat([
      createHash("sha256").update(flowId).digest(),
      SessionRecords.orderKey(cutoff),
    ]);
  },

  /**
   * Reads the required exact application deadline.
   *
   * @param record Complete transaction or grant.
   * @returns Detached validated deadline.
   */
  expiry(record: OidcLoginTransaction | OidcLoginGrant): Timestamp {
    if (record.whenExpires === undefined) throw new Error("OIDC flow record has no expiry.");
    return SessionRecords.deadline(record.whenExpires);
  },

  /**
   * Encodes an exact deadline for provider index ordering.
   *
   * @param record Complete transaction or grant.
   * @returns Flow digest and twelve ordered deadline bytes.
   */
  orderKey(record: OidcLoginTransaction | OidcLoginGrant): Uint8Array {
    return OidcFlowKeys.upperBound(record.flowId, OidcFlowKeys.expiry(record));
  },

  /**
   * Restores the complete mapped principal without losing empty attributes.
   *
   * @param record Consumed application grant.
   * @returns Detached public principal.
   */
  principal(record: OidcLoginGrant): AuthenticatedPrincipal {
    const principal = record.principal;
    if (principal === undefined) throw new Error("OIDC grant has no mapped principal.");
    return Object.freeze(
      principal.attributes === undefined
        ? { id: principal.id }
        : { id: principal.id, attributes: Object.freeze({ ...principal.attributes.values }) },
    );
  },
});
