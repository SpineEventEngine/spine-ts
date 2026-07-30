# T-0080O: Integrate, generate, verify, and close T-0080

## Status

In progress. Repository-wide residuals are measured and bounded planning is
active.

## Parent And Dependencies

- Parent: T-0080.
- Depends on: T-0080J, T-0080K, T-0080L, T-0080M, and T-0080N.
- Final slice.

## Objective

Reconcile shared generation and API expectations after all reviewed remediation
slices, prove no undocumented/name debt remains, regenerate only from authored
sources, and perform the one final repository-wide verification/integration
boundary.

## Classification

High-risk integration. It closes public TypeScript/package and authored
serialized-contract changes across the repository.

## Human-Imposed Requirements Ledger

- All production/example exported APIs and authored example Proto declarations
  satisfy the complete documentation rules.
- All authored TypeScript/example Proto names meet the four-component limit or
  one narrow source-backed compatibility exception.
- Every remaining standalone production/example function has a specific
  necessity disposition.
- Chat uses the approved nested family layout/package coordinates and complete
  foundational README.
- Single-module examples remain flat with `example-*` package names.
- Copied Spine JVM Proto remains unchanged and no generated output is
  hand-edited/tracked.
- All canonical review concerns have durable dispositions.
- One final full verification gate is run after convergence.
- No Spine JVM build and no package publication.

## Ownership

- Shared root expected-export/API-doc lists, generation aggregation, stale path
  removal, checker debt closure, release-readiness expectations, and parent
  task/work/review/completion records.
- Corrections are returned as one batch to the existing affected owner; this
  slice does not opportunistically rewrite production/example semantics.

## Acceptance Criteria

1. Repository-wide TSDoc and semantic-name checks pass with no residual debt
   records. Only exact standalone necessity dispositions and narrow immutable
   wire/JVM compatibility name exceptions may remain.
2. Every exception/disposition resolves to one current declaration, has a
   specific reason/owner, and is neither stale nor duplicated.
3. Clean root generation discovers nested Chat and all flat examples, succeeds
   from authored sources, and leaves generated output ignored/untracked.
4. No stale old Chat path/package coordinate appears in active workspace,
   build, generation, TypeDoc, release-readiness, docs, or package metadata.
5. Package/public export expectations, TypeDoc, Proto manifests, registry
   composition, package payloads, and all consumers agree.
6. Slice review logs show a complete disposition for style/maintainability,
   documentation, TypeScript/API docs, and performance/reliability. Unaffected
   lanes have concrete N/A reasons.
7. Pre-review lint checks status mirrors, accidental exports, duplicated policy,
   future overclaims, generated scratch, and end-user API prohibitions.
8. Any cross-slice findings are deduplicated into one correction batch; only
   substantively affected lanes reopen.
9. One final native `pnpm --config.verify-deps-before-run=false verify` passes
   with at least 90% branch coverage, followed by `git diff --check`, generated
   tracked/clean checks, and exact worktree inspection.
10. Merge/post-merge verification follows tree-equality and change-sensitive
    cadence; task branch, updated `main`, and tags are pushed and remote refs are
    proven before closure.

## Exclusions

- No new runtime/example capability, Wave 5/6 work, npm publication, or
  unrelated baseline cleanup.
- No third whole-change review wave absent unresolved P0/P1 or human direction.
- No duplicated full post-merge gate when the verified and merged trees are
  proven byte-identical and protocol conditions do not require it.

## Verification And Review

- All focused residual checks first, then the one full repository gate.
- Integration review covers only cross-slice/shared reconciliation; it relies
  on accepted immutable slice reviews rather than re-reviewing every unchanged
  package.
- No dedicated security review runs for this corrective program unless the
  human explicitly requests it. Any affected security boundary is recorded for
  the next project/release-readiness security gate.

## Baseline And Planning Dispatch

- Baseline endpoint is pushed umbrella commit `c2812187`.
- Example Proto quality and the production cleanup checker pass.
- TSDoc enforcement reports 237 rows: Storage 90, Server 63,
  Storage Datastore 33, Auth 18, Storage RDBMS 11, Transport 9, Client Web 7,
  Delivery Server 4, and Core 2. Rules are 4 callable summaries,
  26 constructor returns, 35 parameters, 147 returns, and 25 summaries.
- The 26 constructor-return rows may conflict with the human requirement to
  document constructor parameters, because constructors do not have an
  end-user return value. Planning must decide whether the checker is wrong
  before any production comments are added.
- Cleanup-checker tests pass 99/105. All six failures share the known
  `SignalEnvelopes.event`/`.command` dotted-member alias-resolution defect;
  the production checker still passes.
- TypeDoc generation succeeds with one React `children` parameter warning.
  API-doc expectations omit four current Proto Tools exports: `readConfig`,
  `readManifest`, `createManifest`, and `ProtoConfig`.
- The existing requirements splitter is dispatched read-only, explicitly
  `gpt-5.6-sol` with high reasoning. It must validate checker semantics,
  partition non-overlapping implementation ownership, preserve public/runtime
  behavior, define focused gates/review lanes, and avoid another broad
  discovery round. Runtime metadata or its limitation is required.

## Accepted Bounded Plan

- Constructor enforcement is correct: remove 26 existing constructor
  `@returns` tags while retaining summaries and parameter documentation.
- O1 owns 134 Storage-family rows across 16 reported files:
  `storage` 90, `storage-datastore` 33, and `storage-rdbms` 11. It includes 22
  invalid constructor-return tags.
- O2 owns 63 missing async/lifecycle return descriptions across 25 reported
  `server` files.
- O3 owns 40 rows across 14 Auth, Client Web, Core, Delivery Server, and
  Transport files plus:
  `packages/client-react/src/index.ts`,
  `scripts/check-cleanup-rules.mjs`,
  `scripts/check-cleanup-rules.test.mjs`,
  `scripts/check-api-docs.mjs`, and `docs/api/README.md`.
- O3 treats all six cleanup failures as one `SignalEnvelopes.event/command`
  member-resolution defect, documents one named React provider props
  parameter, and replaces obsolete Proto Tools flat-helper expectations with
  the current `ProtoConfig` object. It must not restore compatibility exports.
- All debt ledgers stay empty. The exact 129 standalone necessities remain
  unchanged: F 107, G 13, L 2, M 3, N 4.
- O1/O2 prove identical non-comment TypeScript tokens. Every track runs owned
  TSDoc closure, changed-file ESLint/Prettier, and diff integrity. O3 also
  proves cleanup 105/105, the production checker, TypeDoc without the React
  warning, and API-doc truth.
- One combined review wave covers documentation, TypeScript/API,
  style/maintainability, and factual performance/reliability claims. Security
  is N/A because no security boundary changes.
- The splitter ran as the existing `requirements_splitter`, explicitly
  `gpt-5.6-sol` / high. Runtime self-introspection is unavailable with no
  mismatch.

## Implementation Wave

- O1 closes all 134 owned Storage/Datastore/RDBMS TSDoc rows across 16 files,
  proves identical non-comment TypeScript tokens against `8bb30468`, and
  passes formatting and diff integrity.
- O2 closes all 63 owned Server TSDoc rows across 25 files, proves a
  comment-only diff against `8bb30468`, and passes formatting and diff
  integrity.
- O3 closes all 40 remaining package TSDoc rows, removes four invalid
  constructor return tags, documents one React provider props parameter,
  reconciles Proto Tools expectations/API wording, and fixes the cohesive
  `SignalEnvelopes` member resolver.
- The production cleanup checker and all 105 cleanup tests pass. O3 script
  lint, all changed-file formatting, and diff integrity pass.
- Isolated worktree package-link limitations prevent trustworthy package
  type-aware lint/build and TypeDoc. Those gates run after reviewed integration
  into the dependency-equipped umbrella worktree.
- All implementers were explicitly `gpt-5.6-terra` / medium. Runtime
  self-introspection was unavailable with no visible mismatch.

## Combined Review Dispatch

- Documentation uses the immutable existing reviewer configured
  `gpt-5.6-luna` / medium for concise, accurate TSDoc and API-guide wording.
- TypeScript/API uses the existing reviewer explicitly
  `gpt-5.6-terra` / high for signature/token identity, constructor/return
  contracts, React parameter shape, and Proto Tools export truth.
- Style/maintainability uses the existing reviewer explicitly
  `gpt-5.6-terra` / high for the cleanup resolver and absence of accidental
  runtime restructuring.
- Performance/reliability uses the existing reviewer explicitly
  `gpt-5.6-terra` / high only for factual storage/lifecycle/cancellation/async
  completion claims and cleanup alias coverage.
- Reviewers inspect O1/O2/O3 as one read-only wave, may not edit or spawn, and
  must report actual runtime metadata or its limitation. Security is N/A.

## Combined Review Result And Correction Batch

- TypeScript/API is clean: O1/O2 token identity, scoped TSDoc, constructor
  rules, React signature/arity, Proto Tools exports, and absence of package/
  Proto drift are accepted.
- Documentation/reliability require O2 to correct return semantics for
  `CommandBus.post`, `EventBus.post`, their bounded-context pass-through
  endpoints, and `DeliveryLoop.close`: dispatch promises settle after queued
  work completes and may reject; the delivery loop settles after its active
  run.
- Documentation/reliability require O3 to say `BrowserSession.close()` requests
  cancellation, and `Client.close()` requests general cancellation while
  awaiting subscription/transport cleanup.
- Style/reliability find three P1 cleanup-resolver gaps: nested direct
  import-equals members such as `Core.SignalEnvelopes.event`, local bindings
  shadowing tracked Core/owner aliases, and alias-to-alias propagation after
  `const envelopes = core.SignalEnvelopes`.
- O3 adds focused event/command regressions for all three paths while retaining
  type-only and local-lookalike exclusions. No generic resolver redesign is
  authorized.
- O1 remains closed. O2 reopens documentation/reliability only; O3 reopens
  documentation, style, and reliability. API remains closed unless a
  correction changes signatures/exports.
- Reviewer profiles were immutable Luna/medium documentation and explicit
  Terra/high API, style, and reliability. Runtime self-introspection was
  unavailable with no visible mismatch.

## Correction Completion And Focused Re-review

- O2 corrects exactly five return descriptions across Command Bus, Event Bus,
  their bounded-context pass-through endpoints, and Delivery Loop. Scoped
  TSDoc is zero, non-comment token identity remains exact, and formatting/diff
  checks pass.
- O3 corrects Browser Session and Client lifecycle wording and closes nested
  import-equals, local-shadowing, and indirect-owner alias gaps.
- Red/green focused coverage passes 3/3. The full cleanup suite now passes
  107/107; production enforcement, owned TSDoc, script lint, formatting, and
  diff integrity pass.
- Both existing implementer contexts remained explicit
  `gpt-5.6-terra` / medium. Runtime self-introspection was unavailable with no
  mismatch.
- Documentation reopens for O2/O3 wording, style for the three resolver paths,
  and reliability for both. API remains closed because no signature/export
  changed.

## Review Acceptance

- Documentation focused re-review is clean for all seven Server/Web
  settlement, rejection, cancellation, and awaited-cleanup descriptions.
- Style/maintainability focused re-review is clean for qualified import-equals
  flattening, local shadow-state clearing, indirect owner propagation,
  type-only gating, and bounded resolver structure.
- Performance/reliability focused re-review is clean for the same lifecycle
  and resolver paths. TypeScript/API remains accepted.
- All four canonical concerns are closed; security remains N/A. O1/O2/O3 are
  accepted for scoped commit, immediate push, and ordered integration.
- Reviewer runtime self-introspection remained unavailable; immutable/explicit
  profiles show no mismatch.

## Equipped Integration Findings And Correction

- Generation/build pass and global TSDoc enforcement passes. Cleanup remains
  107/107.
- Global lint exposes two deterministic residuals: `SmokeTaskLists` is a
  static-only class that violates the required named-object pattern, and the
  Proto quality parser retains one unused `next` local.
- TypeDoc generation reaches API checking, which exposes stale Auth truth:
  expectations and the browser/auth extension guide still name removed flat
  `decodeIncomingRequest`/`transportFacts` helpers instead of current
  `IncomingRequests`/`TransportFacts` objects.
- The existing O3 implementer context is explicitly reassigned
  `gpt-5.6-terra` / medium to:
  convert `SmokeTaskLists` to an exported documented object without changing
  method names/behavior; remove the unused parser local; replace Auth API
  expectations and guide/snippet checks with `IncomingRequests.decode` and
  `TransportFacts.from`.
- Ownership is limited to the To-do smoke helper, the Proto/API checker files,
  `docs/BROWSER_CLIENT_AUTH_EXTENSION_GUIDE.md`, and its exact snippet checker.
  No compatibility export, generated edit, runtime auth change, or other
  documentation rewrite is allowed.
- Verification requires global lint/TSDoc, docs check and snippet checks,
  focused To-do tests, cleanup 107/107 unchanged, formatting, and diff
  integrity. Documentation/API/style re-review; reliability is N/A absent
  runtime behavior change.

## Equipped Correction Completion And Review Dispatch

- `SmokeTaskLists` is now an exported documented object with unchanged
  `inspectRows`/`sanitizeValue` call shapes and behavior.
- The unused Proto parser local is removed. Proto quality production checking
  and all 16 checker tests pass.
- Auth API expectations and browser/auth guide/snippet requirements now use
  `IncomingRequests.decode` and `TransportFacts.from`; owned stale-reference
  scans are empty.
- Owned TSDoc, script lint, smoke-source parsing, formatting, and diff integrity
  pass. Isolated To-do/docs/API gates remain package-link blocked and are
  deferred to equipped integration.
- The original implementer remained explicit `gpt-5.6-terra` / medium with
  runtime introspection unavailable and no mismatch.
- Documentation, TypeScript/API, and style reopen read-only for this batch.
  Reliability remains N/A.

## Equipped Correction Review Acceptance

- Documentation is clean for current Auth object APIs, exact signature
  examples, preserved security/limitation guidance, and To-do object TSDoc.
- TypeScript/API is clean: both `SmokeTaskLists` member call shapes are
  preserved with no constructor consumers; Auth source and expectations match;
  guide value imports/type queries are valid.
- Style/maintainability is clean for cohesive object grouping and deterministic
  checker/expectation edits. Reliability remains N/A.
- Reviewer profiles were immutable Luna/medium documentation and explicit
  Terra/high API/style; runtime introspection was unavailable with no mismatch.
- The correction is accepted for commit, immediate push, and merge.
