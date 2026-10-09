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
  ReleaseEvidenceReference,
  ReleaseNotesDocument,
  ReleaseTitle,
} from "../../generated/spine/examples/release_notes/types_pb.js";
import { createHash } from "node:crypto";

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });

const evidenceLine = (reference: ReleaseEvidenceReference): string => {
  const literal =
    `commit=${reference.commit?.value ?? ""} ` +
    `parent=${reference.parent?.value ?? ""} path=${JSON.stringify(reference.path)}`;
  return `  - Evidence: <code>${escapeHtml(literal)}</code>`;
};

/**
 * Keeps Markdown rendering and exact-byte checks consistent for approval and export.
 */
export const ReleaseMarkdown = {
  /**
   * Renders the exact reviewable Markdown bytes from structured draft content.
   *
   * @param title Editor-supplied release title.
   * @param document Current structured document.
   * @returns Canonical UTF-8 bytes for approval and export.
   */
  render(title: ReleaseTitle, document: ReleaseNotesDocument): Uint8Array {
    const lines = [`# ${title.value}`, ""];
    for (const section of document.sections) {
      lines.push(`## ${section.heading}`, "");
      for (const entry of section.entries) {
        lines.push(`- ${entry.text}`);
        for (const reference of entry.evidence) lines.push(evidenceLine(reference));
      }
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
