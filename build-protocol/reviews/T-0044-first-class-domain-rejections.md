# T-0044 Review Log

Status: Slice 1 Round 2 review pending

Baseline: `1aa345ae`

Branch: `task/T-0044-first-class-domain-rejections`

## Review Contract

Review first-class domain rejection behavior against the human requirements,
current active T-0044 records, and verified Spine JVM mechanics. Historical or
superseded text is not actionable unless a current task record or changed
current document claims it as active behavior.

Prioritize concrete defects in Proto compatibility, generated throwable
typing, handler metadata, transaction rollback, event construction, event
publication, acknowledgement timing, public API honesty, and consumer-facing
examples. Do not preserve `CommandRefusalError` merely because it is current.

## Canonical Dispositions

- Style/maintainability: relevant for every executable slice.
- Documentation completeness: relevant for public behavior and final closure;
  a purely internal preparatory slice may justify N/A only if no current docs
  can be affected.
- TypeScript/API docs: relevant for generated/public contracts and every slice
  that changes exports, declarations, handler typing, or TypeDoc.
- Performance/reliability: relevant for transaction, event publication,
  asynchronous acknowledgement, persistence, or dispatch changes.
- Security: final focused integration review is required because serialized
  rejection payloads and stack/error disclosure cross a client-visible
  boundary. It is not added as a routine reviewer to every child slice.

Reviewer assignments, immutable endpoints, packages, explicit/actual model
metadata, results, fixes, and closure evidence remain pending.

## Slice 1 Pre-Review Lint

- Status records agree that T-0044 is active at Slice 1 and project readiness
  remains reopened. The former pending-architecture status in this review log
  was corrected before reviewer dispatch.
- The module-private rejection-construction token is the single nominal
  construction policy. Generator names, suffix policy, dependency version, and
  staged-output paths have no conflicting duplicate constants in the slice.
- `RejectionThrowable` and `createRejectionThrowable` are intentional public
  core contracts required by generated consumer code and are present in the
  TypeDoc export inventory. The construction token and instantiator remain
  private.
- The changed core README limits its claim to validated throwable generation
  and explicitly says event publication is future server-runtime work; it does
  not overclaim Slice 2 behavior.
- `git diff --check`, focused tests, typechecks, docs checks, Proto lint,
  formatting, and generated-output cleanliness passed before review.

## Slice 1 Review Dispositions

- Style/maintainability: relevant; core public abstraction and generator code.
- Documentation completeness: relevant; public core README behavior changed.
- TypeScript/API docs: relevant; two public core exports and generated typing.
- Performance/reliability: relevant; validation, deep freezing, generator
  atomicity, and recursive message handling.
- Security: N/A for this slice under the protocol's final-only security lane;
  no event/client disclosure exists yet. Final T-0044 security review remains
  mandatory.

## Slice 1 Review Wave

- Immutable package: `/private/tmp/t0044-slice1-review.diff`, range
  `1aa345ae..553d837b`, one commit, 51,145 bytes.
- Style/maintainability: existing `style_maintainability_reviewer`, expected
  explicit `gpt-5.6-terra` / high, read-only.
- Documentation completeness: existing `documentation_reviewer`, expected
  explicit `gpt-5.6-luna` / medium, read-only.
- TypeScript/API docs: existing `typescript_api_docs_reviewer`, expected
  explicit `gpt-5.6-terra` / high, read-only.
- Performance/reliability: existing `performance_reliability_reviewer`,
  expected explicit `gpt-5.6-terra` / high, read-only.
- Every reviewer must scope findings to Slice 1, check the human ledger where
  visible, ignore historical superseded text unless current records claim it,
  make no file/Git changes, and spawn no child agents. Dispatch IDs, actual
  fixed-role metadata, findings, and closure remain pending.

Dispatches, each with role, model, and reasoning fields explicit:

- Style/maintainability: `019f6ac2-1eb4-7de1-b4b4-bbb21156c32d` (Volta).
- Documentation: `019f6ac2-2322-7b21-b6ff-27d8c4783d21` (Singer).
- TypeScript/API docs: `019f6ac2-2795-7323-a54f-622c40925eda` (Ampere).
- Performance/reliability: `019f6ac2-2bf2-7980-9993-9637cb9a148c` (Godel).

## Slice 1 Round 1 Findings

All four reviewers completed and were closed before fixes began. The
coordinator execution surface's immutable fixed-role metadata establishes the
actual profiles matching explicit dispatch: style, TypeScript/API docs, and
performance/reliability were `gpt-5.6-terra` / high; documentation was
`gpt-5.6-luna` / medium. Reviewer-local prose could not expose a second
metadata view and is not used to override the fixed-role runtime metadata.

Deduplicated accepted batch:

1. **P1 - binary payload ownership.** Recursive `Object.freeze()` throws on a
   non-empty `Uint8Array`, so valid rejection messages with `bytes` or unknown
   wire bytes cannot be created. Replace deep freeze with private snapshotted
   storage and defensive clones. Cover bytes, unknown fields, maps/nesting, and
   caller mutation isolation.
2. **P1 - runtime nominality.** Constructor privacy does not prevent prototype
   spoofing. Brand factory-created instances in a module-private `WeakSet`,
   export a core-owned `isRejectionThrowable()` guard for Slice 2, and reject a
   prototype-spoofed `Error` in tests.
3. **P1 - source-convention enforcement.** The public factory currently accepts
   any message schema. Require a top-level schema whose descriptor source file
   ends `rejections.proto`; reject ordinary and nested schemas in focused
   tests.
4. **P2 - usable documentation example.** The core README snippet leaves its
   generated companion and ID undefined. Show imports and construction of a
   valid ID so the example is self-contained enough to use.

The style lane additionally identified runtime-writable public fields; private
snapshotted storage plus getters in finding 1 must prevent field replacement.
No separate generator staging defect was found. No fix may begin outside this
complete accepted batch.

## Slice 1 Round 1 Resolution

- Replaced recursive freezing with private binary snapshots produced through
  the message schema. Every public payload read is a defensive clone; bytes,
  unknown fields, nested messages, maps, input mutation, returned-value
  mutation, and runtime property replacement have regression coverage.
- Added a module-private `WeakSet` brand and public
  `isRejectionThrowable()` guard. Factory instances pass; ordinary errors,
  arbitrary objects, and prototype-spoofed errors fail.
- The public factory now checks descriptor metadata for a top-level message in
  a source file ending `rejections.proto`; ordinary and nested schemas fail.
- The core README now imports the generated companion and ID schema and builds
  a valid ID. It documents defensive snapshots without claiming Slice 2 event
  publication.
- Coordinator verification passed: 3 focused files/53 tests, generated and
  tooling typechecks, TypeDoc/API inventory with 31 core exports, generated
  cleanliness, full formatting, and `git diff --check`.
- A fresh commit and Round 2 four-lane package are required; all Slice 1
  dispositions remain open until that wave is clean.
