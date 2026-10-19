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

import { fromBinary, fromJson, toBinary, toJson, type JsonValue } from "@bufbuild/protobuf";
import { VersionSchema } from "@spine-event-engine/proto";
import type { StudioDraft } from "./studio-service.js";
import type { Draft } from "../main/gen/studio.js";

/**
 * Maps the domain Version and exact Markdown bytes at the desktop IPC seam.
 */
export const StudioTransport = {
  /**
   * Validates the complete domain Version before encoding it for desktop IPC.
   *
   * @param value Buf JSON from the displayed Version.
   * @returns A lossless binary spine.core.Version.
   */
  versionWire(value: object): Uint8Array {
    const normalized = fromJson(VersionSchema, value as JsonValue);
    if (!normalized.timestamp) throw new Error("Invalid draft Version.");
    return toBinary(VersionSchema, normalized);
  },

  /**
   * Converts a desktop Version to validated domain JSON without rounding its timestamp.
   *
   * @param value Binary spine.core.Version.
   * @returns Buf JSON for the existing Version validator.
   */
  versionJson(value: Uint8Array | undefined): object {
    if (!value?.length) throw new Error("Invalid draft Version.");
    const decoded = fromBinary(VersionSchema, value);
    if (!decoded.timestamp) throw new Error("Invalid draft Version.");
    return toJson(VersionSchema, decoded) as object;
  },

  /**
   * Creates an exact edit request with detached Markdown bytes.
   *
   * @param id Draft identifier.
   * @param version Displayed domain Version JSON.
   * @param markdown Exact UTF-8 Markdown bytes.
   * @returns Typed desktop edit request.
   */
  editRequest(
    id: string,
    version: object,
    markdown: Uint8Array,
  ): {
    id: string;
    version: Uint8Array;
    markdown: Uint8Array;
  } {
    return { id, version: this.versionWire(version), markdown: new Uint8Array(markdown) };
  },

  /**
   * Maps one authoritative draft without exposing process data.
   *
   * @param value Trusted draft and domain Version.
   * @returns Typed desktop draft.
   */
  draft(value: StudioDraft): Draft {
    return {
      id: value.id,
      version: Buffer.from(this.versionWire(toJson(VersionSchema, value.version) as object)),
      title: value.title,
      audience: value.audience,
      comparison: {
        ...value.comparison,
        changes: value.comparison.changes.map((change) => ({ ...change })),
        commits: value.comparison.commits.map((commit) => ({
          ...commit,
          parents: [...commit.parents],
        })),
        evidence: value.comparison.evidence.map((item) => ({ ...item })),
      },
      generationStatus: value.generationStatus,
      markdown: Buffer.from(value.markdown),
      ...(value.lastEditedAt === undefined ? {} : { lastEditedAt: value.lastEditedAt }),
      ...(value.createdAt === undefined ? {} : { createdAt: value.createdAt }),
    };
  },
};
