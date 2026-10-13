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

import type {
  ReleaseNotesDocument,
  ReleaseTitle,
} from "../../generated/spine/examples/releasenotes/types_pb.js";
import { createHash } from "node:crypto";

/**
 * Converts one validated model proposal into the initial clean editor Markdown.
 */
export const ReleaseMarkdown = {
  /**
   * Renders the initial Markdown once, retaining citations only in proposal history.
   *
   * @param title Editor-supplied release title.
   * @param document Current structured document.
   * @returns Initial UTF-8 Markdown bytes accepted from the model proposal.
   */
  render(title: ReleaseTitle, document: ReleaseNotesDocument): Uint8Array {
    const lines = [`# ${title.value}`, ""];
    for (const section of document.sections) {
      lines.push(`## ${section.heading}`, "");
      for (const entry of section.entries) lines.push(`- ${entry.text}`);
      lines.push("");
    }
    return new TextEncoder().encode(`${lines.join("\n").replace(/\n+$/, "")}\n`);
  },

  /**
   * Checks exact displayed bytes without text normalization.
   *
   * @param left Submitted bytes.
   * @param right Canonical bytes.
   * @returns Whether both byte sequences match.
   */
  matches(left: Uint8Array, right: Uint8Array): boolean {
    return left.length === right.length && left.every((byte, index) => byte === right[index]);
  },

  /**
   * Computes the digest of immutable UTF-8 Markdown bytes.
   *
   * @param bytes Canonical bytes.
   * @returns Lowercase SHA-256 hex digest.
   */
  digest(bytes: Uint8Array): string {
    return createHash("sha256").update(bytes).digest("hex");
  },
} as const;
