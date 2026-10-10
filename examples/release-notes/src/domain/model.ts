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
  AiModel,
  type AiModel as AiCapability,
  type AiValidationIssue,
} from "@spine-event-engine/ai";

import {
  ReleaseGenerationRequestedSchema,
  type ReleaseGenerationRequested,
} from "../../generated/spine/examples/releasenotes/events_pb.js";
import {
  ReleaseNotesDocumentSchema,
  type ReleaseNoteEntry,
  type ReleaseNotesDocument,
} from "../../generated/spine/examples/releasenotes/types_pb.js";

/**
 * Checks model claims against the accepted immutable evidence catalog.
 */
export const ReleaseDocumentValidation = {
  /**
   * Checks one proposed entry against the exact accepted evidence references.
   *
   * @param entry Candidate claim and citations.
   * @param path Candidate field path.
   * @param listed Accepted commit/parent/path keys.
   * @returns Safe local validation issues.
   */
  entry(entry: ReleaseNoteEntry, path: string, listed: ReadonlySet<string>): AiValidationIssue[] {
    const issues: AiValidationIssue[] = [];
    if (!entry.text.trim() || entry.text.length > 2_000)
      issues.push({
        code: "TEXT",
        path: `${path}.text`,
        message: "Use a bounded, nonblank claim.",
      });
    if (entry.evidence.length === 0)
      issues.push({
        code: "MISSING_EVIDENCE",
        path: `${path}.evidence`,
        message: "Cite accepted evidence.",
      });
    for (const [index, evidence] of entry.evidence.entries()) {
      const key = `${evidence.commit?.value ?? ""}\0${evidence.parent?.value ?? ""}\0${evidence.path}`;
      if (!listed.has(key))
        issues.push({
          code: "UNLISTED_EVIDENCE",
          path: `${path}.evidence[${String(index)}]`,
          message: "Cite an exact accepted commit, parent, and path.",
        });
    }
    return issues;
  },

  /**
   * Checks structured claims without Git I/O or provider-dependent facts.
   *
   * @param value Candidate document after Protobuf validation.
   * @param input Accepted generation snapshot and catalog.
   * @returns Domain issues for a bounded recorded correction.
   */
  check: (
    value: ReleaseNotesDocument,
    input: ReleaseGenerationRequested,
  ): readonly AiValidationIssue[] => {
    const listed = new Set(
      input.catalog?.evidence.map(
        (item) => `${item.commit?.value ?? ""}\0${item.parent?.value ?? ""}\0${item.path}`,
      ) ?? [],
    );
    const issues: AiValidationIssue[] = [];
    if (value.sections.length === 0 || value.sections.length > 8)
      issues.push({ code: "SECTIONS", path: "sections", message: "Use one to eight sections." });
    for (const [sectionIndex, section] of value.sections.entries()) {
      const path = `sections[${String(sectionIndex)}]`;
      if (!section.heading.trim() || section.heading.length > 120)
        issues.push({ code: "HEADING", path: `${path}.heading`, message: "Use a short heading." });
      if (section.entries.length === 0 || section.entries.length > 40)
        issues.push({
          code: "ENTRIES",
          path: `${path}.entries`,
          message: "Use one to forty entries.",
        });
      for (const [entryIndex, entry] of section.entries.entries())
        issues.push(
          ...ReleaseDocumentValidation.entry(
            entry,
            `${path}.entries[${String(entryIndex)}]`,
            listed,
          ),
        );
    }
    return issues;
  },
} as const;

/**
 * Defines bounded drafting from the accepted catalog through local read-only Git tools.
 */
export const draftReleaseNotes: AiCapability<
  typeof ReleaseGenerationRequestedSchema,
  typeof ReleaseNotesDocumentSchema
> = AiModel.define({
  name: "draft-release-notes",
  version: "1",
  kind: "generation",
  input: ReleaseGenerationRequestedSchema,
  output: ReleaseNotesDocumentSchema,
  outputMode: "prompt-and-validate",
  instructions: [
    "Draft structured release notes for the supplied audience and instruction.",
    "Use only the accepted comparison and exact catalog evidence.",
    "Call the local read-only Git tools when detail is needed; cite exact commit, parent, and path.",
    "Do not invent changes or claim incomplete detail as confirmed evidence.",
    "Return sections and evidence-backed entries for human review, not an approval.",
  ].join(" "),
  tools: [
    { server: "release-git", tool: "list_release_changes" },
    { server: "release-git", tool: "read_change_patch" },
    { server: "release-git", tool: "read_release_file" },
  ],
  limits: {
    modelRequests: 3,
    toolCalls: 6,
    deadlineMs: 120_000,
    maxInputBytes: 256_000,
    maxOutputBytes: 32_000,
  },
  validation: {
    version: "1",
    check: ReleaseDocumentValidation.check,
  },
});
