# T-0080J: Remediate Chat model modules

## Status

Accepted for commit and integration.

## Parent And Dependencies

- Parent: T-0080.
- Depends on: T-0080D, T-0080H, and T-0080I.
- Required by: T-0080K and T-0080O.

## Objective

Make the Chat and Users model modules fully compliant in authored Proto and
TypeScript, regenerate them from authored sources, and preserve their separate
package/type-registry boundary.

## Classification

High-risk. Authored Proto names/comments and package public model contracts can
change serialized/API contracts.

## Human-Imposed Requirements Ledger

- Every authored example Proto declaration and field has a concise useful
  comment.
- Authored Proto and TypeScript names have at most four semantic components.
- Exported authored TypeScript declarations/members have complete concise
  TSDoc.
- Standalone functions require cohesive ownership or exact necessity
  dispositions.
- Original copied Spine JVM Proto definitions/names remain unchanged.
- Users model remains a separately packaged Chat-family dependency.
- Generated output is regenerated and never hand-edited.
- No Spine JVM build.

## Ownership

- `examples/chat/model` and `examples/chat/users-model` authored Proto,
  authored TypeScript, manifests/config, tests, docs, and quality partitions.
- Exact generated-symbol consumer repairs in Chat app/web when an authored
  model name changes; no unrelated app/web cleanup.

## Acceptance Criteria

1. Owned authored Proto has zero comment/name debt; copied Spine sources are
   byte-unchanged.
2. Owned authored TypeScript has zero TSDoc/name debt and exact dispositions for
   remaining standalone functions.
3. Proto renames preserve field numbers, wire types, service/RPC semantics, and
   package/type-URL intent; all generated consumers and registry tests use the
   new names.
4. Model dependency direction remains acyclic: Chat model may consume Users
   model as recorded, while package/registry identities stay independently
   composable.
5. Clean generation produces compilable ignored output and both model package
   payload/manifests remain publishable.
6. Focused model, Proto-module, manifest, type-URL, and generated-package tests
   pass.

## Exclusions

- No Chat server/browser behavior or broad source cleanup.
- No copied Spine Proto edit.
- No hand-edited generated output.
- No central all-example generation closure.

## Verification And Review

- Focused Proto checks/generation, model package tests, generated typecheck,
  package payload/import checks, TypeDoc/lint/format, checker partitions,
  generated cleanliness, and `git diff --check`.
- Documentation and TypeScript/API-doc lanes are relevant.
- Style/maintainability is relevant for model TypeScript ownership.
- Performance/reliability is N/A absent runtime behavior/resource changes.

## Planning Dispatch

- The existing requirements splitter is explicitly assigned
  `gpt-5.6-sol` / high at this high-risk public/serialized-contract boundary.
- It is read-only, may not spawn subagents, and must return exact authored
  Proto/TypeScript inventory, copied-source exclusions, wire/type-URL/package
  invariants, consumer ownership, bounded implementation tracks, and focused
  acceptance gates.
- Runtime metadata is recorded when exposed; otherwise the immutable configured
  profile and limitation are recorded.

## Accepted Bounded Plan

- Inventory: five authored Proto files, eight messages, 24 fields, and exactly
  32 missing comments. There is zero semantic-name, TSDoc, standalone-function,
  or authored TypeScript production debt.
- No copied Spine Proto exists under either model root. Imported Spine, Google,
  and Users contracts remain dependency-owned and untouched.
- No rename or consumer edit is justified. Proto packages, file paths, field
  numbers/types/order/options, Chat type-URL prefix, Users fallback type URL,
  package/module identities, manifests, and Users→Spine / Chat→Users+Spine
  dependency direction remain frozen.
- One existing implementer, explicitly `gpt-5.6-terra` / medium, owns only the
  five Proto files and `example-proto-debt/T-0080J.json` on isolated branch
  `task/T-0080J-chat-model`.
- Acceptance uses dependency-first generation, model/app/web typebuild,
  registry/package payload/consumer tests, Proto lint/cleanliness, copied-source
  diff, untracked generated-output proof, formatting, cleanup, and diff checks.
- Documentation Luna/medium and API/Protobuf Terra/high reviews are relevant;
  style and reliability are N/A for comment/debt-only changes.
- Splitter runtime self-introspection was unavailable for the explicit Sol/high
  profile, with no visible mismatch.

## Implementation Replacement

- The first explicit Terra/medium implementer produced no edit or blocker and
  was interrupted after repeated status requests; the isolated worktree
  remained clean.
- A fresh existing implementer, explicitly `gpt-5.6-terra` / medium, receives
  the unchanged five-Proto/one-ledger scope in the same clean worktree.
- Runtime metadata or its limitation remains required before acceptance.

## Review Correction Dispatch

- Review found that split-token comment placement bypasses the line-oriented
  Proto quality scanner, producing a false zero ledger.
- One existing implementer, explicitly `gpt-5.6-terra` / medium, owns the five
  Proto comments, J ledger, and only
  `scripts/check-example-proto-quality.mjs` plus its focused tests.
- Acceptance requires leading declaration comments, accurate read-side
  Projection wording, a red/green bypass regression, exact 32-declaration
  recognition, and the original package/wire gates.

## Correction Completion And Re-review

- All 32 comments now precede declaration tokens; `ChatMessageView` is described
  as a read-side Projection.
- The checker and its regression test reject comments inserted between
  declaration tokens. All focused mechanical gates pass, including 14 checker
  tests, generation/lint/verification, 40 source checksums, 49 descriptors,
  model/app/web typebuild, and 123 consumer/workflow/cleanliness tests.
- The correction implementer was explicitly `gpt-5.6-terra` / medium. Runtime
  self-introspection was unavailable, with no visible mismatch.
- Re-review assigns documentation to immutable `gpt-5.6-luna` / medium,
  API/Protobuf to explicit `gpt-5.6-terra` / high, and checker style to explicit
  `gpt-5.6-terra` / high. Reliability is N/A for build tooling and comments.

## Checker Re-review Correction

- Documentation and API/Protobuf re-reviews are clean.
- Style/maintainability found that split comments can still evade RPC, enum
  value, modifier, map, and qualified-type declaration recognition.
- The same existing implementer, explicitly `gpt-5.6-terra` / medium, extends
  the scanner/test correction across all supported declaration prefixes and
  normalizes production Proto fields to readable one-line declarations.
- Only explicit Terra/high style re-review reopens after deterministic gates.
  Runtime metadata or its limitation remains required.

## Complete-Prefix Correction Completion

- The scanner now treats comments anywhere in every supported declaration
  prefix as split-token comments and still records the declaration as missing
  documentation.
- Sixteen focused checker tests cover RPC, enum, modifier, map, qualified-type,
  simple declaration, and valid whitespace cases. All original Proto, build,
  consumer, workflow, and cleanliness gates pass, including 123 focused tests.
- The implementer was explicitly Terra/medium; runtime self-introspection was
  unavailable with no visible mismatch. Only explicit Terra/high style
  re-review is reopened.

## Map Assignment Correction

- Style re-review found one remaining valid map boundary: a comment between the
  field name and `=` could still suppress declaration recognition.
- The same explicit Terra/medium implementer owns only the map parser step and
  exact regression fixture, followed by accepted deterministic gates.
- Only explicit Terra/high style re-review reopens; runtime metadata or its
  limitation remains required.

## Map Assignment Correction Completion

- Map type, field name, and assignment parsing now carry split-comment state
  independently, and the exact valid regression fixture is enforced.
- Checker 16/16 and all affected Proto integrity/format/diff gates pass.
- The implementer was explicitly Terra/medium; runtime introspection was
  unavailable with no mismatch. Final explicit Terra/high style re-review is
  assigned read-only.

## Final Acceptance

- Documentation, API/Protobuf, and style/maintainability reviews are clean.
  Reliability is N/A because no runtime behavior or resource lifecycle changes.
- One deterministic scanner-format finding was corrected; Prettier, checker
  16/16, direct quality, generation, four-project typebuild, Proto lint/source/
  descriptor/generated checks, and diff integrity pass afterward.
- T-0080J is accepted for commit, push, umbrella integration, and
  post-integration verification.
