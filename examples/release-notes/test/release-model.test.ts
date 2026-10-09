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

import { create } from "@bufbuild/protobuf";
import { expect, it } from "vitest";

import { ReleaseGenerationRequestedSchema } from "../generated/spine/examples/releasenotes/events_pb.js";
import {
  GitCommitIdSchema,
  ReleaseEvidenceCatalogSchema,
  ReleaseEvidenceReferenceSchema,
  ReleaseEvidenceSchema,
  ReleaseNoteEntrySchema,
  ReleaseNotesDocumentSchema,
  ReleaseNotesSectionSchema,
  ReleaseTitleSchema,
} from "../generated/spine/examples/releasenotes/types_pb.js";
import { ReleaseDocumentValidation } from "../src/domain/model.js";
import { ReleaseMarkdown } from "../src/domain/markdown.js";

it("renders full immutable evidence references without activating path Markdown", () => {
  const commit = "b".repeat(40);
  const parent = "a".repeat(40);
  const path = "docs/[launch](javascript:alert(1))<&>\"'x\nnote.md";
  const document = create(ReleaseNotesDocumentSchema, {
    sections: [
      create(ReleaseNotesSectionSchema, {
        heading: "Changes",
        entries: [
          create(ReleaseNoteEntrySchema, {
            text: "Documented the launch.",
            evidence: [
              create(ReleaseEvidenceReferenceSchema, {
                commit: create(GitCommitIdSchema, { value: commit }),
                parent: create(GitCommitIdSchema, { value: parent }),
                path,
              }),
            ],
          }),
        ],
      }),
    ],
  });
  const markdown = new TextDecoder().decode(
    ReleaseMarkdown.render(create(ReleaseTitleSchema, { value: "October release" }), document),
  );
  expect(markdown).toContain(`commit=${commit} parent=${parent}`);
  expect(markdown).toContain(
    "path=&quot;docs/[launch](javascript:alert(1))&lt;&amp;&gt;\\&quot;&#39;x\\nnote.md&quot;",
  );
  expect(markdown).not.toContain('path="docs/[launch](javascript:alert(1))');
});

it("requires every proposed claim to cite exact accepted catalog evidence", () => {
  const commit = create(GitCommitIdSchema, { value: "b".repeat(40) });
  const parent = create(GitCommitIdSchema, { value: "a".repeat(40) });
  const input = create(ReleaseGenerationRequestedSchema, {
    catalog: create(ReleaseEvidenceCatalogSchema, {
      evidence: [
        create(ReleaseEvidenceSchema, {
          commit,
          parent,
          path: "release.md",
          status: "M",
        }),
      ],
    }),
  });
  const candidate = create(ReleaseNotesDocumentSchema, {
    sections: [
      create(ReleaseNotesSectionSchema, {
        heading: "Changes",
        entries: [
          create(ReleaseNoteEntrySchema, {
            text: "The release guide was updated.",
            evidence: [
              create(ReleaseEvidenceReferenceSchema, {
                commit,
                parent,
                path: "release.md",
              }),
            ],
          }),
        ],
      }),
    ],
  });
  expect(ReleaseDocumentValidation.check(candidate, input)).toEqual([]);
  const entry = candidate.sections[0]?.entries[0];
  const cited = entry?.evidence[0];
  if (!entry || !cited) throw new Error("Missing release entry fixture.");
  cited.path = "unlisted.md";
  expect(ReleaseDocumentValidation.check(candidate, input)).toEqual(
    expect.arrayContaining([expect.objectContaining({ code: "UNLISTED_EVIDENCE" })]),
  );
  entry.evidence = [];
  expect(ReleaseDocumentValidation.check(candidate, input)).toEqual(
    expect.arrayContaining([expect.objectContaining({ code: "MISSING_EVIDENCE" })]),
  );
});

it("rejects empty and oversized document structure before a proposal can be staged", () => {
  const input = create(ReleaseGenerationRequestedSchema);
  expect(ReleaseDocumentValidation.check(create(ReleaseNotesDocumentSchema), input)).toEqual([
    expect.objectContaining({ code: "SECTIONS", path: "sections" }),
  ]);
  const candidate = create(ReleaseNotesDocumentSchema, {
    sections: [create(ReleaseNotesSectionSchema, { heading: " ", entries: [] })],
  });
  expect(ReleaseDocumentValidation.check(candidate, input)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: "HEADING", path: "sections[0].heading" }),
      expect.objectContaining({ code: "ENTRIES", path: "sections[0].entries" }),
    ]),
  );
  candidate.sections = Array.from({ length: 9 }, () =>
    create(ReleaseNotesSectionSchema, { heading: "Changes" }),
  );
  expect(ReleaseDocumentValidation.check(candidate, input)).toEqual(
    expect.arrayContaining([expect.objectContaining({ code: "SECTIONS" })]),
  );
});

it("rejects a plausible citation when its parent differs and bounds claim text", () => {
  const commit = create(GitCommitIdSchema, { value: "b".repeat(40) });
  const parent = create(GitCommitIdSchema, { value: "a".repeat(40) });
  const input = create(ReleaseGenerationRequestedSchema, {
    catalog: create(ReleaseEvidenceCatalogSchema, {
      evidence: [create(ReleaseEvidenceSchema, { commit, parent, path: "release.md" })],
    }),
  });
  const candidate = create(ReleaseNotesDocumentSchema, {
    sections: [
      create(ReleaseNotesSectionSchema, {
        heading: "Changes",
        entries: [
          create(ReleaseNoteEntrySchema, {
            text: "x".repeat(2_001),
            evidence: [
              create(ReleaseEvidenceReferenceSchema, {
                commit,
                parent: create(GitCommitIdSchema, { value: "c".repeat(40) }),
                path: "release.md",
              }),
            ],
          }),
        ],
      }),
    ],
  });
  expect(ReleaseDocumentValidation.check(candidate, input)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: "TEXT", path: "sections[0].entries[0].text" }),
      expect.objectContaining({
        code: "UNLISTED_EVIDENCE",
        path: "sections[0].entries[0].evidence[0]",
      }),
    ]),
  );
});
