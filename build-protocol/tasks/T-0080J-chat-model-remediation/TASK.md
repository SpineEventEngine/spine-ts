# T-0080J: Remediate Chat model modules

## Status

In progress.

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
