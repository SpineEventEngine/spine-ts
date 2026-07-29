# T-0075 Review Record

Status: Pending

All four canonical specialist concerns apply:

- Style/maintainability: package boundaries, ownership, naming, test quality,
  and avoidance of speculative abstractions.
- Documentation: browser/auth/session/deployment workflows, examples,
  limitations, diagrams, third-party flows, and extension guidance.
- TypeScript/API docs: exports, runtime/type agreement, browser-safe
  declarations, package contracts, and compile-checked snippets.
- Performance/reliability: reconnect generations, retry bounds, backpressure,
  cancellation, cleanup, session lifetime, forwarding limits, and cross-runtime
  behavior.

A final `security_reviewer` gate is mandatory for credentials, OAuth/OIDC
callbacks, cookies/CSRF/CORS, tokens/keys, session fixation/replay/revocation,
Actor/tenant rewriting, subscription ownership, redaction, model decoding,
forwarding limits, and deployment trust claims.

Assignments, explicit runtime metadata, complete review waves, dispositions,
corrections, and re-review evidence will be recorded before acceptance.

## P1 review assignments

- Style/maintainability: existing `style_maintainability_reviewer`, expected and
  explicitly dispatched `gpt-5.6-terra` / `high`. Review only fixture tooling,
  tests, manifest cohesion, ownership, and maintainability.
- Documentation: existing `documentation_reviewer`, expected
  `gpt-5.6-luna` / `medium`, both required explicitly. Review only lock/report
  claims, provisional status, capability evidence, and operator workflow.
- Performance/reliability: existing `performance_reliability_reviewer`,
  expected and explicitly dispatched `gpt-5.6-terra` / `high`. Review archive
  bounds/containment, fetch/extract atomicity, checksum timing, source
  immutability, process/network behavior, cleanup, and deterministic failure.
- TypeScript/API docs: N/A for P1 because it adds no TypeScript declaration,
  package export, public runtime API, or end-user snippet. This disposition will
  be reconsidered when client packages change.
- Security: archive/build supply-chain findings are retained for the mandatory
  final Wave 4 security gate; P1 does not invoke that release gate early.

Every reviewer is read-only, may not edit or spawn children, and must return
CLEAN or exact prioritized P0-P2 findings. Independent self-introspection is
not exposed; explicit dispatch and immutable configured role/profile are the
metadata evidence.

## P1 complete review wave

Runtime metadata:

- Style/maintainability ran as the existing reviewer under explicitly
  dispatched `gpt-5.6-terra` / `high`.
- Documentation could not be dispatched on Desktop because that surface
  rejected Luna before execution. The existing reviewer configuration was
  routed through CLI; its runtime banner confirmed `gpt-5.6-luna` / `medium`,
  read-only sandbox, and the configured documentation remit.
- Performance/reliability ran as the existing reviewer under explicitly
  dispatched `gpt-5.6-terra` / `high`.
- Independent self-introspection was unavailable. No role/profile fallback or
  mismatch was exposed.

Accepted consolidated correction batch:

- P1: file-global capability regexes reject the real pinned source and permit
  disconnected token false positives. Replace them with file-specific API
  predicates and negative tests. Real Projection/Event delivery remains launch
  evidence, not a token scan.
- P1: `ServerTest` does not execute Command, Query, Projection subscription, or
  Event subscription behavior. Configure the smallest unmodified-source
  fixture harness or exact upstream test set which truly exercises all four
  native endpoints; keep the result provisional until it actually runs.
- P1: archive/cache publication is not atomic or concurrency-safe. Use a
  revision lock and per-run staging, verify before atomic publication, clean
  staging in `finally`, and test interruption, failure/retry, and concurrent
  prepares.
- P1: archive validation checks names but not symlink targets. Reject links or
  prove every resolved target remains under the locked root, including
  malicious absolute/traversing-link tests.
- P1: expanded archive size is unbounded. Lock and enforce a total
  uncompressed-size limit before extraction.
- P1: the executed Gradle distribution is outside the integrity chain. Lock its
  exact URL/SHA-256, verify wrapper properties, and require checksum-backed
  distribution resolution before a permitted probe.
- P2: remove the unused Git-clean helper/test and exercise the actual source
  digest invariant through `prepareFixture()`, including mutation and
  command-failure cleanup.
- P2: correct and enforce toolchain claims. Upstream `BuildSettings` targets
  Java 17, while the attempted launcher was Java 21; the manifest/runbook must
  distinguish and verify these facts rather than claim an unevidenced Java 21
  fixture toolchain.
- P2: add a concise operator runbook covering prerequisites, online/offline
  behavior, expected success output, cache cleanup, and exact promotion
  evidence/action.

The fixture's provisional status, official revision/archive/wrapper checksums,
native capability wording, and unexecuted-build limitation were otherwise
accurately documented. TypeScript/API remains N/A for P1. One correction batch
returns to the existing implementation context; all three invoked concerns
reopen.

## P1 scope-change disposition

The user subsequently prohibited building Spine JVM during Wave 4. This
supersedes the accepted findings that required an executed Gradle/native launch
probe and exact executable JDK/Gradle build chain. Those findings are deferred,
not represented as satisfied. P1 must instead expose only an immutable,
checksum-verified, safely extracted unmodified source reference and static
service/descriptor capability evidence. The implementation must be unable to
invoke a Spine JVM build. Style, documentation, and reliability reopen over
that reduced behavior; TypeScript/API remains N/A.

## P1 static-only re-review assignments

- Style/maintainability: existing `style_maintainability_reviewer`, explicitly
  dispatched `gpt-5.6-terra` / `high`.
- Documentation: existing `documentation_reviewer`, explicitly dispatched
  through the configured CLI profile as `gpt-5.6-luna` / `medium` because the
  Desktop child surface does not accept Luna as an explicit override.
- Performance/reliability: existing
  `performance_reliability_reviewer`, explicitly dispatched
  `gpt-5.6-terra` / `high`.
- Each reviewer is read-only, owns only the static-source P1 boundary, may not
  spawn children, and must return `CLEAN` or exact P0-P2 findings. The
  configured role/profile and dispatch command are the available runtime
  metadata; independent self-introspection is not exposed.
- TypeScript/API remains N/A because P1 adds no TypeScript declaration, package
  export, runtime API, or end-user snippet. Security supply-chain observations
  remain reserved for the mandatory final Wave 4 security gate.

## P1 static-only complete re-review wave

Runtime metadata:

- Style/maintainability ran as the existing reviewer under explicitly
  dispatched `gpt-5.6-terra` / `high`; independent self-introspection was
  unavailable.
- Documentation ran through CLI with a runtime banner confirming
  `gpt-5.6-luna` / `medium`, approval `never`, and read-only sandbox.
- Performance/reliability ran as the existing reviewer under explicitly
  dispatched `gpt-5.6-terra` / `high`; independent self-introspection was
  unavailable.
- No role/profile mismatch or inherited fallback was exposed. No reviewer
  built or executed Spine JVM.

Documentation is `CLEAN`. TypeScript/API remains N/A. Style and reliability
confirmed that the active fixture has no Gradle, JDK, Java, or JVM build/launch
path.

Accepted deduplicated correction batch:

- P1: parse actual `zipinfo` metadata rather than a fabricated format, and add
  end-to-end malicious ZIP tests proving expanded-size and escaping-symlink
  rejection.
- P1: pin and verify a deterministic source-tree digest before consuming
  capabilities; include relevant symbolic-link metadata and test cache/source
  mutation.
- P1: make the revision lock safe for realistic slow concurrent prepares,
  ownerless/crashed locks, stale owners, and live-owner renewal; add held,
  stale, ownerless, and slow-owner tests.
- P1: bound archive download bytes and time while transfer is in progress, not
  only after completion.
- P2: reject normalized archive entries that are not strictly inside the
  locked root, including `<root>/../unexpected`.
- P2: clean or recover random `.ready` publication trees after interruption so
  retries cannot accumulate full source copies.

One correction batch returns to the existing P1 implementation context.
Documentation does not reopen for deterministic evidence updates; style and
reliability reopen after behavior changes.

## P1 final affected re-review assignments

- Style/maintainability: existing `style_maintainability_reviewer`, explicitly
  dispatched `gpt-5.6-terra` / `high`, limited to the accepted static-fixture
  corrections and coordinator lock fix.
- Performance/reliability: existing
  `performance_reliability_reviewer`, explicitly dispatched
  `gpt-5.6-terra` / `high`, limited to archive integration, source digest,
  download bounds, publication cleanup, and lock lifecycle.
- Both are read-only, may not build Spine JVM or spawn children, and must return
  `CLEAN` or exact remaining P0-P2 findings. Independent self-introspection is
  unavailable; explicit dispatch and immutable configured profiles are runtime
  metadata evidence.

## P1 final affected re-review results

Both reviewers ran under the explicitly dispatched
`gpt-5.6-terra` / `high` profiles; independent self-introspection was
unavailable. Neither reviewer built or ran Spine JVM.

Accepted final correction batch:

- P1: replace the ineffective unknown-length `curl --max-filesize` assumption
  with a genuinely streaming byte-bounded and time-bounded source download;
  add an unknown-length overflow regression.
- P1: make archive metadata parsing fail closed and prove one-to-one coverage of
  `unzip -Z1` entries; add malicious expanded-size and escaping-symlink
  end-to-end `prepareFixture()` tests.
- P1: verify the pinned tree digest and capabilities entirely in staging before
  publishing source; test mismatch cleanup, preservation, and retry.
- P1: atomically quarantine the exact stale/ownerless lock generation before
  removal so competing waiters cannot delete a newly acquired live lock; add
  competing-takeover coverage.
- P1: add an end-to-end pinned-digest mutation failure through
  `prepareFixture()`, not only helper-level digest tests.
- P2: correct the README sentence to say the workflow never downloads a JDK
  **or** Gradle.

The code otherwise resolves the previous structural and wait-deadline findings.
One final correction returns to the existing P1 implementation context; style
and reliability reopen only for these behavior changes.

## P1 correction-complete acceptance re-review

- Style/maintainability: existing `style_maintainability_reviewer`, explicitly
  dispatched `gpt-5.6-terra` / `high`, limited to confirming the final
  end-to-end regressions and README correction.
- Performance/reliability: existing
  `performance_reliability_reviewer`, explicitly dispatched
  `gpt-5.6-terra` / `high`, limited to streaming bounds, fail-closed metadata,
  staged validation/publication, competing stale-lock takeover, and integration
  tests.
- Both are read-only, may not build/run Spine JVM or spawn children, and must
  return `CLEAN` or exact remaining P0-P2 findings. Explicit dispatch and
  immutable configured profiles are runtime metadata evidence because
  independent self-introspection is unavailable.

## P1 acceptance re-review results

Both reviewers ran under explicitly dispatched `gpt-5.6-terra` / `high`;
independent self-introspection was unavailable. Static inspection only was
performed; no JVM/fixture build ran.

Accepted correction batch:

- P1: compare archive-entry and metadata path multiplicities exactly (or reject
  duplicates), not only set membership; add a duplicate-count mismatch test.
- P1: bind stale takeover to the observed generation with a serialized
  acquisition/takeover protocol so a delayed stale observer cannot quarantine
  a replacement live lock; add that exact forced-interleaving regression.
- P2: inject the download timeout and test an abort-aware stalled body through
  `prepareFixture()`, including partial-file cleanup.
- P2: add a `prepareFixture()` integration case proving staged capability
  rejection preserves the prior published source and cleans staging.

All other previous findings are resolved. One final correction returns to the
same P1 owner; style and reliability reopen only for these four changes.

## P1 final integration acceptance assignments

- Style/maintainability: existing `style_maintainability_reviewer`, explicitly
  dispatched `gpt-5.6-terra` / `high`, limited to exact metadata multiplicity
  and the two new end-to-end `prepareFixture()` regressions.
- Performance/reliability: existing
  `performance_reliability_reviewer`, explicitly dispatched
  `gpt-5.6-terra` / `high`, limited to generation-safe stale takeover,
  stalled-download cleanup/retry, and capability-rejection preservation/retry.
- Both are read-only, may not run/build Spine JVM or spawn children, and must
  return `CLEAN` or exact remaining P0-P2 findings. Explicit dispatch and
  immutable configured profiles are runtime metadata evidence; independent
  self-introspection is unavailable.

## P1 final integration acceptance results and simplification disposition

Both reviewers ran under explicitly dispatched `gpt-5.6-terra` / `high`;
independent self-introspection was unavailable. Neither ran a JVM build or
fixture command.

The reviewers confirmed exact metadata multiplicity and staged
capability-rejection behavior, but found that cross-process stale takeover and
directory replacement still cannot preserve the claimed shared-publication
invariants. They also found the timeout integration did not write/assert a real
partial file, and the same-process takeover map retained keys.

Disposition: remove the unnecessary shared extracted-source publication and
revision-lock subsystem. P1 is a static, one-shot source-reference tool. It
will retain only the checksum-verified immutable archive cache, extract and
validate in a unique per-run staging directory, return static digest/capability
evidence, and clean that staging directory in `finally`. With no shared
extracted source, stale takeover, directory replacement, prior-publication
preservation, and takeover-map lifetime are N/A by construction. Concurrent
runs may independently validate the same immutable archive. Timeout coverage
must emit a partial chunk and prove the caller-owned staged download is removed.
Style and reliability reopen over this simplified boundary.

## P1 archive-only final acceptance assignments

- Style/maintainability: existing `style_maintainability_reviewer`, explicitly
  dispatched `gpt-5.6-terra` / `high`, reviewing only cohesion, test quality,
  and obsolete-abstraction removal in the archive-only/per-run design.
- Performance/reliability: existing
  `performance_reliability_reviewer`, explicitly dispatched
  `gpt-5.6-terra` / `high`, reviewing only streaming bounds, immutable archive
  publication, fail-closed archive checks, per-run staging isolation/cleanup,
  and concurrent overlap.
- Both are read-only, may not run/build Spine JVM or spawn children, and must
  return `CLEAN` or exact P0-P2 findings. Explicit dispatch and immutable
  configured profiles are runtime metadata evidence; independent
  self-introspection is unavailable.

## P1 archive-only final acceptance results

- Style/maintainability: `CLEAN`, under explicitly dispatched
  `gpt-5.6-terra` / `high`.
- Performance/reliability: one P1 finding under explicitly dispatched
  `gpt-5.6-terra` / `high`: checksum verification uses `readFile()` for an
  allowed 256 MiB archive and multiplies memory across concurrent callers.
  Replace it with incremental file-stream hashing while preserving size and
  cleanup behavior.
- Independent reviewer self-introspection was unavailable. Neither reviewer ran
  a JVM build or fixture command. Reliability alone reopens for this correction.

## P1 incremental checksum re-review assignment

- Performance/reliability: existing
  `performance_reliability_reviewer`, explicitly dispatched
  `gpt-5.6-terra` / `high`, limited to incremental checksum memory bounds,
  stream-error propagation, and existing archive cleanup/bounds.
- Read-only; no JVM build/fixture run or child dispatch. Return `CLEAN` or exact
  P0-P2 findings. Explicit dispatch/configured profile is runtime metadata
  evidence; independent self-introspection is unavailable.

## P1 final disposition

- Style/maintainability: `CLEAN`.
- Documentation: `CLEAN`.
- TypeScript/API: N/A; P1 adds no TypeScript declaration, package export,
  runtime API, or end-user snippet.
- Performance/reliability: `CLEAN` after incremental checksum re-review.
- Security: archive/source supply-chain behavior remains listed for the
  mandatory final Wave 4 security gate; no early release gate was invoked.

All invoked reviewers used the explicitly recorded existing roles and required
profiles. Independent self-introspection was unavailable where noted; no
visible mismatch or inherited fallback occurred. P1 is accepted as a static
source reference only. It makes no JVM runtime compatibility claim and no
reviewer built or ran Spine JVM.

## P1 verification disposition

The change-sensitive full Spine TS gate passed after it was granted the local
IPC socket access required by the existing ZeroMQ and gRPC integration suites:
141 test files and 2,649 tests passed; 3 files and 25 tests were skipped. The
initial sandboxed `EPERM` failures were reproduced as an environment restriction
on ZeroMQ IPC binding, not a product or P1 regression. No Spine JVM build or
execution was part of either verification attempt.

P1 is accepted for commit and push. The final Wave 4 security concern remains
open for the release gate, as recorded above.

## A1 consolidated review-wave assignments

The A1 boundary is the behavior-preserving rename of `packages/client` to
`packages/client-node`, the public package identity change to
`@spine-event-engine/client-node`, and migration of all live workspace
consumers, tooling, and current documentation.

- Style/maintainability: existing `style_maintainability_reviewer`, expected
  `gpt-5.6-terra` / `high`, both explicit in dispatch. Review rename cohesion,
  repository organization, test maintainability, and accidental non-mechanical
  changes.
- Documentation: existing `documentation_reviewer`, immutable configured
  `gpt-5.6-luna` / `medium`. Review current public prose, snippets, package
  ownership claims, and preservation of intentional historical records.
- TypeScript/API: existing `typescript_api_docs_reviewer`, expected
  `gpt-5.6-terra` / `high`, both explicit in dispatch. Review package exports,
  declarations, dependency/reference migration, executable identity checks,
  and public compatibility within the approved rename.
- Performance/reliability: N/A for A1 because the implementation moves the
  existing source and preserves its runtime behavior, transport lifecycle,
  bounds, and tests without changing execution logic.
- Security: no new credential, trust-boundary, parser, or runtime behavior is
  introduced. The current threat-model path was migrated; the mandatory final
  Wave 4 security gate remains open.

All reviewers are read-only, must preserve shared worktree changes, must not
spawn children, and must not build or run Spine JVM. They return `CLEAN` or
exact P0-P2 findings. Independent runtime self-introspection is unavailable on
this surface, so configured role/profile plus explicit dispatch fields are the
runtime metadata evidence unless a visible mismatch occurs.

## A1 consolidated review-wave results

- Style/maintainability: `CLEAN`, under the explicitly dispatched existing
  reviewer and `gpt-5.6-terra` / `high` profile.
- Documentation: `CLEAN`, under the existing reviewer's immutable configured
  `gpt-5.6-luna` / `medium` profile. The dispatch surface does not accept a
  redundant model override for this fixed role; the exact required role/profile
  was explicit in the assignment.
- TypeScript/API: `CLEAN`, under the explicitly dispatched existing reviewer
  and `gpt-5.6-terra` / `high` profile.
- Performance/reliability: N/A for the reason recorded in the assignment.
- Security: deferred to the mandatory final Wave 4 gate for the reason recorded
  in the assignment.

Independent runtime self-introspection was unavailable for all three invoked
reviewers; no visible mismatch or inherited fallback occurred. No reviewer
built or ran Spine JVM.

After the review wave, independent deterministic verification found one
mechanical migration omission not reported as a reviewer finding:
`scripts/check-api-docs.mjs` still constructed `clientIndexPath` from
`packages/client/src/index.ts`, causing `pnpm docs:check` to fail with `ENOENT`.
This single path correction returns to an existing `implementer`, expected and
explicitly dispatched as `gpt-5.6-terra` / `medium`. It may update only the
stale checker path plus durable evidence, must rerun the affected docs/API
checks and precise stale-reference scans, and may not commit, push, merge,
spawn children, or build/run Spine JVM. The clean reviewer lanes do not reopen
because this is deterministic path correction with no public declaration,
prose, or runtime change.

## A1 final disposition

The deterministic checker-path correction passed the affected TypeDoc/API,
snippet, formatting, stale-reference, and diff checks. A fresh full Spine TS
gate passed 141 test files / 2,650 tests, with 3 files / 25 tests skipped.
The preceding unchanged delivery-server signal-test transient passed all 4
cases in focused reproduction before the clean full rerun.

Final A1 concerns:

- Style/maintainability: `CLEAN`.
- Documentation: `CLEAN`.
- TypeScript/API: `CLEAN`.
- Performance/reliability: N/A; runtime behavior is unchanged.
- Security: no A1-specific finding; mandatory Wave 4 final gate remains open.

A1 is accepted for commit and immediate push. No Spine JVM build or execution
was used for implementation, review, or verification.

## A2 consolidated review-wave assignments

The A2 boundary introduces `@spine-event-engine/client-web`, moves the common
client lifecycle behind its browser-safe transport-injection seam, makes
`client-node` a native transport/UUID adapter, freezes the approved public
verbs, removes legacy client verbs without aliases, and migrates live
BlackBox/Chat/Todo/docs consumers.

- Style/maintainability: existing `style_maintainability_reviewer`, expected
  and explicitly dispatched `gpt-5.6-terra` / `high`. Review module depth,
  adapter/kernel cohesion, duplication removal, test maintainability, and
  whether the broad test deletions preserve adequate behavioral evidence.
- Documentation: existing `documentation_reviewer`, immutable configured
  `gpt-5.6-luna` / `medium`, explicitly named in the assignment. Review both
  package READMEs, user/testing guides, raw wire-decoding examples, limitations,
  and future-slice claims.
- TypeScript/API: existing `typescript_api_docs_reviewer`, expected and
  explicitly dispatched `gpt-5.6-terra` / `high`. Review exports,
  declarations, Node return types, the transport-injection contract, approved
  verb removal, TypeDoc attribution aliases, package/lock/project references,
  and browser-safe public types.
- Performance/reliability: existing `performance_reliability_reviewer`,
  expected and explicitly dispatched `gpt-5.6-terra` / `high`. Review
  close/in-flight behavior, subscription activation/cancellation races,
  abort propagation, transport ownership/cleanup, idempotency, raw stream
  lifecycle, and whether A2 accidentally regresses guarantees before A4.
- Security: no credentials or gateway boundary are introduced in A2; browser
  dependency isolation and context overwrite remain in the specialist scope,
  while the mandatory final Wave 4 security gate remains open.

All reviewers are read-only, share the worktree, may not spawn children, and
may not build or run Spine JVM. Return `CLEAN` or exact P0-P2 findings. The
surface does not expose independent runtime self-introspection; configured
role/profile and explicit assignment are accepted metadata absent a visible
mismatch.

## A2 consolidated review-wave results

All four relevant lanes completed under the pre-recorded existing roles and
profiles. Independent runtime self-introspection was unavailable; no visible
mismatch or inherited fallback occurred. No reviewer built or ran Spine JVM.

- Style/maintainability:
  - P1: `Client.close()` does not own or cancel admitted subscriptions, and the
    broad deletion of lifecycle tests hides the regression.
  - P1: current guide/snippet migration is incomplete and contains invalid or
    stale examples.
- TypeScript/API:
  - P1: no independent expected/declaration/TypeDoc export inventory exists for
    the new `client-web` package.
  - P1: the Node `Client` factory is accidentally constructible and its return
    type is ambiguous in TypeDoc.
  - P2: Node TypeDoc attribution aliases and the same-reference error
    constructor export lack accurate public documentation/kind explanation.
- Performance/reliability:
  - P1: close is not terminal for admitted unary work, inactive or active
    subscriptions, or activation after close.
  - P1: concurrent activation, cancellation during activation, repeated
    cancellation, stalled cancellation, and local iterator termination are
    unsafe or unbounded.
  - P1: Subscribe results and delivered update identities are not validated;
    the positive test currently accepts protocol-invalid missing IDs/topics.
  - P2: the guide claims signal cleanup and bounded decoded buffering that are
    not implemented in A2.
- Documentation:
  - P1: an old observed-post/outcome-events example uses removed API.
  - P1: raw Topic examples miss imports and call an undefined cancellation
    variable.
  - P2: query decoding, raw update behavior, activation timing, signal/buffer
    guarantees, package ownership, TypeDoc entry count, and transport-factory
    limitations are stale or incomplete.
  - P2: the testing README is not self-contained and dropped still-public
    `postEvent`, `eventually`, tenant/zone/timeout workflows and constraints.

## A2 correction batch

One existing `implementer` receives the aggregated batch, expected and
explicitly dispatched as `gpt-5.6-terra` / `medium`:

1. Restore owner-tracked terminal close for admitted unary work and all
   subscription states, with ordered/idempotent bounded cleanup and regression
   tests.
2. Serialize activation/cancellation, cancel late Subscribe results, terminate
   local iteration, share cancellation completion/failure, and bound remote
   cleanup. Reuse established finite lifecycle constants/patterns where
   available; do not invent reconnect behavior.
3. Validate accepted subscription identity/topic and every delivered update
   identity before exposure; cancel on invalid acceptance.
4. Restore focused lifecycle/protocol tests removed from the Node suite by
   porting them to the shared kernel contract.
5. Make the Node factory nonconstructible and its returned kernel type
   unambiguous; accurately document its local TypeDoc aliases/error constructor
   identity.
6. Add independent `client-web` declared-export and TypeDoc-module inventory
   enforcement.
7. Repair and compile-check all current examples and prose. Explicitly state
   that concrete browser transports arrive in A3 and reconnect, signal-lifetime
   composition, bounded queues, overflow, and gap/resync lifecycle arrive in
   A4; do not claim them in A2.
8. Restore a self-contained testing README covering the still-public testing
   workflows and constraints, and correct root/API ownership/status counts.

The owner must preserve the approved verbs and browser isolation, may not add
compatibility aliases, and may not commit, push, merge, spawn children, or
build/run Spine JVM. All affected lanes reopen for one focused re-review.

## A2 correction evidence and focused re-review assignments

The correction now has:

- terminal owner tracking, serialized activation/cancellation, finite cleanup,
  accepted/update identity validation, and the five exact race/failure
  regressions requested by review;
- 17 focused web-kernel tests and native branch coverage 81/89 (91.01%);
- 5 total client files / 48 tests and the exact 3 BlackBox/Chat/Todo files /
  51 tests passing;
- independent API inventories for 31 Node and 8 web exports;
- corrected package factories/declarations, guides, testing workflows,
  ownership/status claims, and explicit A3/A4 deferment;
- root build, browser dependency scan, docs/API, snippet, formatting, diff,
  legacy-verb, and temporary-artifact checks passing.

All four affected concerns reopen once:

- Style/maintainability: existing reviewer, explicitly dispatched
  `gpt-5.6-terra` / `high`, focused on lifecycle cohesion, test quality, and
  correction completeness.
- Documentation: existing fixed reviewer, explicitly assigned immutable
  `gpt-5.6-luna` / `medium`, focused on every prior guide/README finding and
  compile-valid examples/deferments.
- TypeScript/API: existing reviewer, explicitly dispatched
  `gpt-5.6-terra` / `high`, focused on independent web inventory,
  nonconstructible Node factory, unambiguous kernel types, and documented
  attribution aliases/error identity.
- Performance/reliability: existing reviewer, explicitly dispatched
  `gpt-5.6-terra` / `high`, focused on every prior close/race/cleanup/identity
  finding and the new 91.01% coverage evidence.

Reviewers are read-only, may not spawn children, and may not build/run Spine
JVM. Return `CLEAN` or exact remaining P0-P2 findings. Independent runtime
self-introspection remains unavailable; configured profile plus explicit
dispatch is the accepted metadata absent visible mismatch.

## A2 focused re-review results

- Style/maintainability:
  - P1: early iterator return releases owner tracking without remotely
    cancelling, so later close cannot clean the live subscription.
  - P1: guide examples/claims remain broken, and syntax-only snippet
    transpilation cannot detect missing local symbols.
- Performance/reliability:
  - P1: remote cancellation timeout is cooperative only; a transport ignoring
    abort can still stall forever.
  - P1: cancellation failures can skip owner release, and fail-fast close can
    stop orderly settlement of remaining cleanup.
  - All other prior lifecycle, race, identity, natural-completion, and A4
    deferment findings are resolved.
- Documentation:
  - P1/P2: stale raw-subscription semantics, missing `TopicSchema`, undefined
    cancellation variable, false signal/buffer guarantees, missing raw query
    decoding, stale TypeDoc count/terminology, and ambiguous curated-inventory
    wording remain.
  - Package READMEs and the restored testing README are otherwise clean.
- TypeScript/API:
  - P1: the same broken guide contradicts the frozen public contract.
  - P2: public `ClientRequest` operations, `Subscription` operations, and
    `ClientTransport.createRequestId` lack member-level TypeDoc.
  - Independent inventories, nonconstructible Node factory, returned kernel
    identity, aliases/error constructor docs, and project/package references
    are clean.

## A2 final correction batch

A fresh existing `implementer`, expected and explicitly dispatched
`gpt-5.6-terra` / `medium`, owns only:

1. Race the remote Cancel RPC against a real finite timeout so public cleanup
   settles even when transport ignores abort; safely observe any late
   completion/rejection.
2. Release subscription ownership in `finally`, settle every subscription
   cleanup, and close the owned source exactly once even when individual
   cleanup fails; report failures without skipping later cleanup.
3. Make early iterator return perform the same bounded remote cancellation;
   natural completion must release without a redundant Cancel.
4. Add exact RED/GREEN regressions for all three behaviors and retain ≥90%
   native web branch coverage.
5. Repair all named guide/API status defects, show explicit raw
   `QueryResponse`/`Any` and `SubscriptionUpdate` handling, and accurately
   defer signal-lifetime composition/bounded queues/overflow to A4.
6. Strengthen snippet checking to detect unresolved local symbols in the
   affected snippets, rather than syntax-only transpilation.
7. Add member-level TypeDoc for every new public web interface operation.

No other A2 design is reopened. No compatibility aliases, reconnect,
commit/push/merge, child dispatch, or Spine JVM build/execution are allowed.
Only substantively affected style, docs, API, and reliability points reopen
after deterministic evidence.

## A2 correction implementation evidence

The existing `implementer` completed the consolidated correction under the
explicitly dispatched `gpt-5.6-terra` / `medium` profile. Independent runtime
self-introspection is unavailable; no visible profile mismatch occurred.

- Shared-kernel regressions cover terminal close of admitted unary/inactive
  work, invalid accepted subscription cancellation, and serialized concurrent
  activation with cancellation during a late Subscribe result. The kernel now
  owner-tracks cleanup, validates accepted and delivered identities/topics,
  shares cancellation completion, bounds remote cancellation, and closes the
  owned source in `finally`.
- `client-node` exposes a nonconstructible documented factory with explicit
  kernel return types and documented local aliases/error identity. The API
  checker independently enforces the eight `client-web` declaration and
  TypeDoc exports.
- Current guides, root/API counts, package READMEs, and testing workflows were
  repaired; A3 transports and A4 reconnect/signal/queue/overflow/gap-resync
  remain explicitly deferred.
- Focused client suite: 5 files / 36 tests passed; the elevated BlackBox/Chat/Todo
  loopback suite passed 3 files / 51 tests. Web/Node typechecks,
  repository TypeScript build, browser dependency scan, TypeDoc API inventory,
  formatting, and diff checks passed.

## A2 client-web coverage correction evidence

- Coverage-specific RED/GREEN found and corrected two public lifecycle defects:
  an already-aborted activation signal could reach `Subscribe`, and an invalid
  delivered subscription identity could surface as normal completion. The
  narrow correction rejects the former before transport use and preserves the
  latter as an iterator failure after finite cleanup.
- The shared kernel now has 17 behavior-focused tests. Fresh isolated native
  coverage is 81/89 branches (91.01%); the complete client-web/client-node
  suite is green at 5 files / 48 tests. The covered contract includes command
  outcomes and acknowledgement validation, context validation/cloning, send
  builder/abort/close behavior, and subscription identity/topic/update,
  activation/cancellation/close/natural-completion ownership paths.
- This correction uses neither coverage exclusions nor implementation-only
  exports and adds no reconnect, transport-factory, or A4 queue/gap behavior.
  Fresh root `typecheck:build`, `pnpm format:check`, and `git diff --check`
  passed.

## A2 final correction implementation evidence

- RED/GREEN regressions prove non-cooperative finite Cancel settlement,
  owner/source cleanup despite failures, early iterator remote cancellation,
  natural-completion no-recancel behavior, and failed activation compensation
  with original-plus-cleanup failure reporting. The corrected kernel observes
  late Cancel completion/rejection, removes terminal owners in `finally`,
  settles all close cleanups before failure reporting, and closes an owned
  source exactly once.
- Guide/API corrections now explicitly handle raw `QueryResponse` packed `Any`
  values and `SubscriptionUpdate` variants, remove undefined locals, correct
  the TypeDoc entry-point count, and defer signal-lifetime composition, queues,
  overflow, reconnect, and gap/resync to A4. The checker now includes a
  semantic unresolved-local pass for client snippets in addition to syntax and
  public-export checks. Required member TSDoc is present.
- Deterministic evidence: client tests 5 files / 51 tests; loopback
  BlackBox/Chat/Todo tests 3 files / 51 tests; root build, docs/snippets/API,
  browser dependency scan, formatting, and diff check passed. Isolated
  client-web coverage is 91/99 branches (91.91%), above the 90% gate. The
  sandboxed loopback attempt was blocked only by `listen EPERM`; the required
  unrestricted rerun passed.

## A2 final coordinator disposition

The coordinator inspected the corrected lifecycle paths and reran every
change-sensitive gate after the second complete review wave. The activation
failure path always releases ownership even when compensating cancellation
fails; client close settles every subscription cleanup attempt before closing
the source exactly once; remote cancellation is finite even for a
non-cooperative transport; early iterator return performs bounded cancellation;
and natural stream completion releases ownership without a redundant Cancel.

All accepted P1 and P2 findings from both review waves are resolved. No P0/P1
risk remains, so the protocol's two-wave limit applies and no third complete
review wave is opened. Canonical concern dispositions are:

- style/maintainability: accepted after the final correction and targeted
  lifecycle inspection;
- documentation completeness: accepted after compile-checked raw
  `QueryResponse` / `SubscriptionUpdate` examples and explicit A3/A4
  limitations;
- TypeScript/API docs: accepted after independent 8-web / 31-node export
  inventories and member-level TSDoc;
- performance/reliability: accepted after finite cleanup, all-settled close,
  ownership-release, early-return, and natural-completion regressions.

Fresh targeted evidence is 5 client files / 51 tests, 3 native loopback files /
51 tests, 20 isolated web-kernel tests, 91.91% web branch coverage (91/99),
root TypeScript build, TypeDoc/API, semantic snippet, browser dependency,
formatting, and diff checks. No Spine JVM build or execution was performed.

## A3 consolidated review-wave assignments

The A3 endpoint adds the public explicit browser protocol factories, per-call
metadata provider, Web Crypto request IDs, exact Connect-Web dependency, tests,
and narrow API/package documentation. Pre-review lint found no stale status,
compatibility alias, hidden fallback, A4 reconnect claim, auth/session
implementation claim, Node/React/codegen dependency leak, or accidental export.
Fresh mechanical evidence is 5 client files / 55 tests, root TypeScript build,
TypeDoc/API inventory with 10 web exports, dependency isolation, formatting,
and diff cleanliness.

All reviewers must apply the complete Human-Imposed Requirements Ledger in the
T-0075 task, review only the A3 diff from `26843990`, preserve the no-JVM-build
boundary, and return `CLEAN` or exact P0-P2 findings:

- Style/maintainability: existing `style_maintainability_reviewer`; expected
  `gpt-5.6-terra` / `high`, both explicit in dispatch. Inspect the factory and
  metadata seams, naming, duplication, test maintainability, and whether this
  remains the smallest idiomatic TypeScript API.
- Documentation completeness: existing `documentation_reviewer`; expected
  immutable `gpt-5.6-luna` / `medium`. The Desktop spawn surface rejected Luna
  as a free model override, so the successful dispatch explicitly selected the
  fixed documentation role and named its immutable Luna/medium profile in the
  prompt rather than falsely recording accepted override fields. Verify the
  package/API claims, protocol selection, synchronous metadata semantics,
  secure-ID failure, and A4/C5 deferrals against code.
- TypeScript/API docs: existing `typescript_api_docs_reviewer`; expected
  `gpt-5.6-terra` / `high`, both explicit in dispatch. Inspect public types,
  declaration/TypeDoc inventory, browser compatibility, factory signatures,
  test compile coverage, and compatibility with the existing injected seam.
- Performance/reliability: existing `performance_reliability_reviewer`;
  expected `gpt-5.6-terra` / `high`, both explicit in dispatch. Inspect
  per-request metadata freshness/error behavior, secure randomness paths,
  protocol non-fallback, request ordering, retained secrets/resources, and A2
  lifecycle regressions.

The Desktop surface exposes immutable role profiles but not independent runtime
self-introspection. Before accepting each result, record the configured profile
and whether any visible mismatch occurred. No reviewer may edit, commit, push,
merge, spawn children, or build/run Spine JVM.

## A3 consolidated review-wave results

The complete wave returned no P0/P1 findings and four overlapping P2 findings.
The three Terra/high dispatches explicitly named model and reasoning; runtime
self-introspection was unavailable and no mismatch was visible. The
documentation dispatch used the immutable `documentation_reviewer`
Luna/medium role after the surface rejected Luna as a free override; the role
profile and limitation were explicit, with no visible mismatch. No reviewer
edited files or built/ran Spine JVM.

Accepted, deduplicated findings:

1. The factory tests cast `Client` through hand-authored `unknown` shapes, so
   they do not compile-check the real public static methods or
   `BrowserClientOptions`.
2. The mocked transports bypass the registered interceptors and cover only
   gRPC-Web Post plus Connect Read. They do not prove both factories support
   both operations, fresh metadata is requested for every call, or a metadata
   provider failure prevents transport invocation.
3. The user guide still says concrete browser transports arrive in A3 and calls
   the client an A2 kernel. It has no current browser factory/metadata snippet
   or secure-ID failure explanation.
4. The guide must distinguish the synchronous A3 caller-owned header hook from
   C5 cookie/session/OIDC/provider authentication and retain the A4
   reconnect/queue/gap deferral.

Production factory structure, explicit non-fallback selection, UUID v4
version/variant bits, package/API claims, dependency boundary, and A2 lifecycle
behavior were otherwise clean.

## A3 correction batch

The existing A3 `implementer` context owns one behavior-first correction:

1. call `Client.forGrpcWeb()` / `Client.forConnect()` directly in tests and
   compile-check a real `BrowserClientOptions` value;
2. use the smallest interceptor-aware test harness that covers both protocols ×
   Post/Read, changing metadata on successive calls, and provider failure before
   `next`/transport;
3. update the practical user-guide browser-client section and compile-checked
   snippet for explicit protocol choice, synchronous request metadata, Web
   Crypto request-ID failure, C5 auth/session/provider deferral, and A4
   lifecycle deferral;
4. rerun focused clients, semantic snippets/docs/API, dependency isolation,
   root TypeScript build, formatting/diff, and scoped web coverage.

Expected existing role/profile remains explicitly dispatched
`gpt-5.6-terra` / `medium`; the follow-up reuses that immutable implementation
context. It may change only A3 tests/docs and minimal checker support if a real
compile-check requires it. It may not add A4/C5 behavior, aliases, commit, push,
merge, children, or any Spine JVM build/execution.

## A3 correction implementation evidence

- Existing `implementer` context, explicitly dispatched `gpt-5.6-terra` /
  `medium`; independent runtime self-introspection is unavailable, with no
  visible profile mismatch.
- The corrected test uses direct `Client.forGrpcWeb()` / `Client.forConnect()`
  calls and a real `BrowserClientOptions` value. A minimal interceptor-aware
  transport harness proves both protocols execute both `Post` and `Read`, each
  call receives newly supplied metadata, and a throwing provider reaches
  neither the harness next function nor transport. No factory probing/fallback
  or production behavior was added.
- The practical user guide has a compile-checked browser-client snippet and
  exact A3/C5/A4 boundary language: explicit protocol choice, synchronous
  header provider, Web Crypto request-ID failure, auth/session/provider
  deferral, and reconnect/queue/gap deferral.
- Fresh evidence: `client-web` 25/25, web+Node focused suite 5 files / 56
  tests, root TypeScript build, semantic snippets, TypeDoc/API inventory,
  dependency isolation, formatting, and diff hygiene passed. Scoped web
  coverage is 90.99% branches (101/111). No Spine JVM build or execution
  occurred.

## A3 targeted re-review results

Every substantively affected concern is clean:

- style/maintainability: the interceptor-aware harness is minimal, calls the
  real public factories, proves four fresh values, and contains no production
  duplication;
- TypeScript/API docs: direct calls, typed `BrowserClientOptions`, emitted
  declarations, and public guide imports/signatures all match;
- documentation completeness: the compile-checked guide now states explicit
  non-fallback selection, synchronous metadata, secure-ID behavior, and exact
  A4/C5 deferrals;
- performance/reliability: both protocols execute Post and Read, metadata is
  fresh per call, and a provider exception reaches neither `next` nor
  transport. The reviewer independently passed 25/25 web tests.

Configured profiles remained the original explicit Terra/high reviewers and
the immutable Luna/medium documentation role. Independent runtime
self-introspection was unavailable, no visible mismatch occurred, and no
reviewer edited files or built/ran Spine JVM. No P0-P2 finding remains. A3 is
accepted subject to the full TypeScript repository gate, commit, and immediate
task-branch push.

## A4.1 migration completion — coordinator evidence

- Scope was mechanical caller/doc migration after the A4.1 public contract and
  bounded-channel implementation reached 31 focused-green tests. No production
  lifecycle/reconnect behavior was changed here.
- The migration satisfies the frozen discriminated contract: Todo TaskList is
  Entity with a matching all-row/by-ID authoritative query, Todo rejection is
  Event, Chat state is Entity with its factored by-ID query, Chat MessagePosted
  is Event, and BlackBox ProjectionState/EventState use matching include-all
  Entity/Event selections. Consumers read `subscription.updates` and unwrap raw
  update deliveries.
- The concrete migration compile finding (`client-node` missing public
  `SubscriptionDelivery` and `SubscriptionLifecycle` aliases) is resolved and
  covered by the successful root typecheck. BlackBox's wrapper now exposes the
  replacement streams rather than treating Subscription itself as iterable.
- Verification is clean: root `typecheck:build`; migrated loopback 3 files / 51
  tests; TypeDoc/API inventory; semantic snippets; browser dependency checker;
  format and diff checks; scoped web coverage 92.25% branches (143/155),
  97.03% statements, 31/31 tests. The accidental repository-wide coverage
  invocation failed its global threshold only because its include set covered
  unrelated packages; the required scoped command passed.
- No Spine JVM source was built or executed. This record is evidence for the
  coordinator's relevant A4.1 review disposition, not a new reviewer lane.

## A4.1 specialist review wave assignments

The review base is pushed A3 commit `09a12fb3`; the package is the complete
uncommitted A4.1 diff. Reviewers must apply the full Human-Imposed Requirements
Ledger in
`build-protocol/tasks/T-0075-wave4-browser-interoperability/TASK.md`, the exact
A4 contract freeze in `build-protocol/work-logs/T-0075.md`, and the explicit
prohibition on building or executing Spine JVM.

- Style/maintainability: existing `style_maintainability_reviewer`; expected
  `gpt-5.6-terra` / `high`, both explicit in dispatch.
- TypeScript/API documentation: existing `typescript_api_docs_reviewer`;
  expected `gpt-5.6-terra` / `high`, both explicit in dispatch.
- Performance/reliability: existing `performance_reliability_reviewer`;
  expected `gpt-5.6-terra` / `high`, both explicit in dispatch.
- Documentation completeness: existing `documentation_reviewer`; immutable
  configured profile `gpt-5.6-luna` / `medium`. The Desktop role dispatch
  selects that configured profile; independent runtime self-introspection is
  unavailable. The reviewer is required because public guide, README, TSDoc,
  and API inventory claims changed.

Each reviewer is read-only, owns one distinct concern, may run only focused
Spine TS checks, and may not edit, commit, push, merge, spawn children, or
build/run/generate/test Spine JVM. Actual runtime metadata will be recorded
when the surface exposes it; otherwise the immutable role profile and
limitation above are the honest acceptance evidence.

## A4.1 complete review wave results and correction batch

All four existing reviewers completed read-only reviews. The surface exposed
their immutable configured roles/profiles but not independent runtime
self-introspection; no visible mismatch occurred. The style, TypeScript/API,
and reliability lanes used the explicitly dispatched Terra/high profiles. The
documentation lane used its immutable Luna/medium profile. Focused reviewer
checks passed, no reviewer edited files, and no Spine JVM project was built,
run, generated, or tested.

Accepted and deduplicated findings:

1. P0: graceful wire completion calls a channel close that discards already
   buffered deliveries. Graceful completion must preserve and drain queued
   values; cancellation may use a separate terminal discard path.
2. P1: concurrent `next()` calls overwrite the sole pending resolver and can
   strand a promise. They must be queued or rejected deterministically.
3. P1: repeated/concurrent `activate()` emits duplicate `connecting`
   notifications and can overflow outside owned cleanup. The one memoized
   activation pipeline must own the transition.
4. P1: count/byte and lifecycle overflow store one error but propagate a
   replacement error to the other stream. Both streams must observe the same
   terminal error object and cleanup must remain bounded.
5. P1: detached update-consumer cleanup can reject without containment, while
   cancellation during activation can replace locally completed streams with
   failure. Detached failures must be contained and cancellation must preserve
   terminal `done`.
6. P2: the byte-capacity reclamation test uses a loose limit and does not prove
   that dequeue releases bytes. Tighten it to one encoded delivery at a time.
7. P2: public TSDoc must say retries are after the initial attempt and explain
   lifecycle-variant fields.
8. P1/P2 documentation: the browser-client guide paragraph and
   `packages/client-web/README.md` still claim bounded queues/overflow are
   absent. They must describe current A4.1 behavior and defer only reconnect,
   resynchronization/gap recovery, and remaining signal-lifetime behavior.
9. P3: remove the obsolete, unread `#terminated` promise.

The API reviewer also correctly observed that the Entity authoritative-query
target is not yet compared with the Topic. The frozen design requires the
factory to remain deferred, and the executable split assigns factory
evaluation plus target comparison to A4.3. It is therefore accepted as an
A4.3 requirement rather than an A4.1 defect. The misleading A4.1 test title
must be corrected now; A4.3 must add the mismatch regression before runtime
recovery is accepted.

One consolidated correction returns to the existing `implementer` context,
expected `gpt-5.6-terra` / `medium`, explicitly recorded and dispatched. It
owns the findings above in client-web production/tests/docs and exact
mechanical evidence only. Caller migrations are frozen. It may not add
reconnect/resynchronization behavior, commit, push, merge, spawn children, or
build/run/generate/test Spine JVM.

## A4.1 consolidated correction evidence and targeted re-review

- The existing implementer context (`gpt-5.6-terra` / `medium`, explicitly
  dispatched; independent runtime metadata unavailable with no visible
  mismatch) completed the one correction batch. Graceful completion now drains
  accepted values while explicit cancellation discards them; a second pending
  `next()` rejects deterministically; activation owns one `connecting`
  transition; both streams receive the identical overflow error; detached
  cleanup is contained without replacing cancellation's local terminal result;
  the exact-byte regression proves dequeue reclamation; dead state is removed;
  and TSDoc/README/guide claims match A4.1.
- The Entity query factory remains deferred and untouched. A4.3 owns first
  evaluation, Topic-target comparison, and mismatch regression.
- Fresh coordinator evidence passed: web plus Node clients 5 files / 66 tests;
  root TypeScript build with 39 frozen Proto source checksums and 48 descriptor
  digests; scoped web coverage 35/35 with 91.62% branches and 95.42%
  statements. Implementer evidence additionally passed the complete
  documentation/API inventory, semantic snippets, browser dependency,
  formatting, and diff checks. No Spine JVM project was executed.
- Because the correction substantively affects all four concerns, one targeted
  second and final review wave reuses the existing reviewers. Expected
  profiles remain style, API, and reliability at explicit
  `gpt-5.6-terra` / `high`, plus the immutable documentation reviewer at
  `gpt-5.6-luna` / `medium`. Review is limited to accepted findings and
  regressions; reviewers are read-only and may not execute Spine JVM.

## A4.1 review convergence

- Targeted style/maintainability re-review is clean: the owned activation
  transition, graceful drain/cancel discard split, byte-reclamation regression,
  pending-read handling, overflow identity, and dead-state removal introduce no
  maintainability finding.
- Targeted performance/reliability re-review is clean: all accepted queue,
  cancellation, overflow, cleanup, and resource-ownership findings are resolved;
  its focused 35-test run passed.
- Targeted documentation re-review is clean: the browser guide, client-web
  README, and public TSDoc agree on A4.1 bounded streams and terminal overflow,
  and accurately defer recovery behavior.
- Targeted TypeScript/API re-review confirmed exact exports/inventories, public
  retry/lifecycle TSDoc, unevaluated `authoritativeQuery`, and durable A4.3
  ownership. Its sole P3 was a stale test title. The existing implementer
  renamed only that title; focused 35/35, formatting, and diff checks passed.
  This deterministic correction does not reopen a lane.
- Every canonical concern is clean, every accepted P0-P3 is resolved, and no
  reviewer profile mismatch occurred. No review or correction built, ran,
  generated, or tested the Spine JVM project. A4.1 is accepted subject to the
  full TypeScript repository gate, commit, and immediate task-branch push.

## A4.2 specialist review wave assignments

The review base is pushed A4.1 commit `190c66be`; the review package is the
complete uncommitted A4.2 diff. Reviewers must apply the full Human-Imposed
Requirements Ledger, A4 contract freeze, and A4.2 acceptance/evidence in the
work log.

- Style/maintainability: existing `style_maintainability_reviewer`, expected
  explicit `gpt-5.6-terra` / `high`.
- TypeScript/API documentation: existing `typescript_api_docs_reviewer`,
  expected explicit `gpt-5.6-terra` / `high`.
- Performance/reliability: existing `performance_reliability_reviewer`,
  expected explicit `gpt-5.6-terra` / `high`.
- Documentation completeness: existing `documentation_reviewer`, immutable
  configured `gpt-5.6-luna` / `medium`; the fixed role does not accept a free
  model override on this surface.

The Desktop surface exposes configured immutable profiles but not independent
runtime self-introspection; no result is accepted on a visible mismatch. Each
reviewer is read-only, owns one concern, and may run focused Spine TS checks
only. No reviewer may edit, commit, push, merge, spawn children, or build/run/
generate/test Spine JVM.

## A4.2 complete review wave and correction batch

All four existing concerns completed. The style/API/reliability reviewers used
their explicitly dispatched Terra/high profiles. The first documentation turn
stalled in a mechanical check and was interrupted without acceptance; the same
immutable Luna/medium role was redispatched for a bounded static review and
returned clean. Independent runtime self-introspection was unavailable, no
visible mismatch occurred, no reviewer edited files, and no Spine JVM work
occurred.

Accepted, deduplicated findings:

1. P1: `cancel()` and `Client.close()` can remain unbounded while a transport's
   Subscribe promise ignores abort, because cancellation awaits the unresolved
   activation. The owner/listeners/source close remain retained.
2. P1: cancellation aborts but never disposes the active stream iterator. A
   non-cooperative `next()` can retain the consume loop and owner indefinitely.
3. P2: overflow classification depends on English
   `ClientProtocolError.message.includes(...)` fragments. A typed internal
   overflow marker/result must select the established overflow terminal path.

One consolidated correction returns to the existing `implementer` context,
expected explicit `gpt-5.6-terra` / `medium`. It must:

- race pending Subscribe and iterator reads against terminal cancellation so
  local activation/consumption and client close settle without waiting for a
  non-cooperative transport;
- detach only the minimum late-result continuation needed to perform one
  bounded Cancel on a wire accepted after local cancellation, without
  retaining the subscription/client owner path;
- invoke iterator `return()` when present without allowing a non-cooperative
  return to block terminal cleanup;
- preserve exact cancel-Promise identity, terminal notice ordering, one
  cleanup per accepted wire, and A4.3 deferrals; and
- replace message parsing with a private typed overflow signal and add focused
  non-cooperative Subscribe/next/return plus classification regressions.

The owner may change only A4.2 client runtime/tests and evidence, may not begin
A4.3, and may not commit, push, merge, spawn children, or execute Spine JVM.

## A4.2 targeted final re-review assignments

The consolidated correction is complete. The final targeted wave reopens only
the concerns substantively affected by the correction:

- Style/maintainability: existing `style_maintainability_reviewer`, expected
  explicit `gpt-5.6-terra` / `high`; review the typed overflow marker and the
  terminal-race/late-cleanup helper structure.
- TypeScript/API documentation: existing `typescript_api_docs_reviewer`,
  expected explicit `gpt-5.6-terra` / `high`; review exact `cancel()` promise
  identity, public terminal semantics, and preservation of the A4.3 boundary.
- Performance/reliability: existing
  `performance_reliability_reviewer`, expected explicit
  `gpt-5.6-terra` / `high`; verify bounded local settlement, detached
  non-retaining late cleanup, iterator disposal, and exactly one Cancel per
  accepted wire.

All three fields are explicit in dispatch. The Desktop surface exposes each
immutable configured role/profile but not independent runtime
self-introspection; a visible mismatch invalidates a result. Documentation
completeness is not reopened because the correction changes only private
runtime mechanics and focused tests; the public TSDoc and guides reviewed clean
in the complete A4.2 wave remain unchanged. Every reviewer is read-only and
must use only focused Spine TS checks. The permanent Wave 4 rule allows static
read-only Spine JVM references only and forbids JVM builds, tests, generation,
dependency resolution, or any other project execution.

## A4.2 targeted final re-review results

- Performance/reliability is clean. Focused 45/45 tests confirm prompt local
  settlement for non-cooperative Subscribe/stream reads, non-retaining late
  continuations, exactly one bounded Cancel per accepted wire, observed raw
  rejections, and best-effort non-blocking iterator disposal. No A4.3 behavior
  was introduced.
- TypeScript/API is clean. Exact memoized `cancel()` Promise identity,
  `closed` versus `failed` terminal semantics, public exports/TSDoc, and the
  A4.3 boundary are preserved.
- Style/maintainability confirms the typed overflow marker and helper
  structure are clean, with one remaining P2 verification gap: the focused
  tests do not supply an iterator `return()` that rejects or never settles, so
  they do not directly prove that best-effort disposal is invoked and cannot
  delay terminal settlement.

The immutable configured reviewer profiles were visible and matched the
explicit dispatches; independent runtime self-introspection remained
unavailable. Focused tests and diff hygiene passed, and no Spine JVM operation
occurred. The one deterministic correction returns to the existing
`implementer`, expected explicit `gpt-5.6-terra` / `medium`: add a focused
regression for one invocation of a rejecting or never-settling iterator
`return()` while cancellation/client close still settles locally. Production
behavior must remain unchanged. This test-only correction does not reopen
already clean review lanes.

## A4.2 review convergence

- The test-only iterator-disposal correction proves one invocation of a
  rejecting optional `return()` while local cancellation, client/source close,
  stream completion, and exactly-one remote Cancel remain prompt. It changes no
  production behavior and resolves the final style P2.
- The unrestricted full gate initially exposed two stale lifecycle callers;
  both now assert the documented terminal `closed` notice followed by stream
  completion. Their elevated focused suites passed 48/48.
- The final coverage-only batch added two meaningful A4.2 behavior cases and
  restored the unchanged global branch threshold. Because these were
  deterministic test/assertion corrections, they do not reopen clean review
  lanes.
- All canonical A4.2 concerns are clean. The final full TypeScript gate passed
  140 runnable files / 2,612 tests and 90.00% branches (8,356/9,284). No
  reviewer-profile mismatch and no Spine JVM project operation occurred.

## A4.3 specialist review assignments

The review base is pushed A4.2 commit `f36d0926`; the review package is the
complete uncommitted A4.3 runtime/test/evidence diff. Classification is
high-risk because finite retries, generation fencing, Entity authoritative
recovery, bounded queues, and cancellation interact.

- Style/maintainability: existing `style_maintainability_reviewer`, expected
  explicit `gpt-5.6-terra` / `high`.
- TypeScript/API documentation: existing `typescript_api_docs_reviewer`,
  expected explicit `gpt-5.6-terra` / `high`.
- Performance/reliability: existing
  `performance_reliability_reviewer`, expected explicit
  `gpt-5.6-terra` / `high`.
- Documentation completeness: N/A for this runtime slice because A4.4 is the
  immediately following public-guide/README regression-closure slice. Public
  TSDoc is still in API-review scope now; A4.3 may not be released or merged
  without A4.4.

All dispatched fields are explicit. The Desktop surface exposes configured
immutable role/profile metadata but not independent runtime
self-introspection; any visible mismatch invalidates a result. Reviewers are
read-only, own distinct concerns, and may run focused Spine TS checks only.
The permanent Wave 4 rule permits static read-only Spine JVM references only
and forbids JVM builds, tests, generation, dependency resolution, launch, or
other project execution.

## A4.3 complete review wave and correction batch

All three affected existing concerns completed under their explicit
Terra/high assignments. Independent runtime self-introspection was unavailable;
the immutable configured roles/profiles matched, no reviewer edited files, and
no Spine JVM operation occurred. Focused client tests passed 63/63 and diff
hygiene passed.

Accepted and deduplicated findings:

1. P1: a caller abort can still permit a later retry Subscribe when an injected
   scheduler ignores its abort signal, because recovery checks `#cancelled`
   rather than the controller's aborted state after the wait. Fence attempt
   admission and RPC dispatch on `#controller.signal.aborted` before and after
   every wait.
2. P1: retryable stream failure clears the current iterator without invoking
   its best-effort `return()`; failed Entity resynchronization can overwrite an
   attached replacement iterator; and terminal non-cancellation cleanup does
   not dispose it. Generation fencing prevents delivery but does not release
   the transport/local reader resource. Dispose and clear each abandoned
   iterator without awaiting a non-cooperative `return()`.

One consolidated correction returns to the existing productive `implementer`
context, expected explicit `gpt-5.6-terra` / `medium`. It owns only the A4.3
client runtime/tests/evidence and must add abort-ignoring-scheduler plus
return-spy regressions for stream retry, failed Entity Read retry/exhaustion,
and terminal cleanup. It may not begin A4.4, commit, push, merge, spawn
children, or execute any Spine JVM project operation.

### A4.3 review-regression correction evidence

- The retry path retains the failed stream iterator until `#recover()` calls
  the existing clear-before-return disposal helper. Mocked Connect regressions
  prove exactly-once, non-blocking disposal for retryable stream failure and
  the Entity transient-Read retry/final-non-OK path; rejecting and
  never-settling returns do not delay local terminal behavior, and later close
  does not duplicate return.
- The abort-ignoring scheduler regression proves caller activation abort fences
  retry admission after the wait resolves: `activate()` rejects, only the
  initial Subscribe occurs, and lifecycle terminates as `failed`.
- Focused two-file test run passed 67/67. Scoped coverage measured `client.ts`
  at 95.64% statements, 92.55% branches, 95.32% functions, and 97.73% lines;
  its nonzero exit is limited to unchanged workspace-global coverage thresholds
  for unexecuted packages. Root `typecheck:build`, diff hygiene, and Prettier
  passed. The correction is ready for the existing targeted re-review; no JVM
  project operation occurred.

### A4.3 API P1 bounded scheduler-wait correction

- A direct scheduler wait could remain pending forever after caller abort when
  a custom scheduler ignored its signal. Recovery now routes that wait through
  `raceTerminal()` using the subscription controller, preserving the existing
  post-wait elapsed and controller checks and observing any later raw wait
  rejection.
- The exact initial-retry regression passed: a never-settling scheduler wait
  yields prompt activation rejection on caller abort, no second Subscribe, one
  `failed` lifecycle terminal then done, and a settling client close. Focused
  tests passed 68/68; root `typecheck:build`, Prettier, and diff hygiene passed.

## A4.3 targeted final re-review assignments

The existing style, TypeScript/API, and performance/reliability concerns are
reopened only for the two accepted P1 findings and their regressions. Expected
profiles remain explicitly `gpt-5.6-terra` / `high` for each existing reviewer.
The Desktop surface exposes immutable configured profiles but not independent
runtime self-introspection; visible mismatches invalidate results. Review is
read-only, focused Spine TS checks only, with the permanent no-Spine-JVM-
execution rule in force.

## A4.3 targeted re-review result and final correction

- Style/maintainability is clean for clear-before-return iterator ownership and
  the focused mocked-Connect seams.
- Performance/reliability is clean for exactly-once nonblocking iterator
  disposal across Event and Entity retry/exhaustion paths.
- TypeScript/API confirms the released-wait abort fence but finds one P1:
  directly awaiting an injected scheduler that ignores abort and never settles
  can keep initial `activate()` pending forever. Race the scheduler wait against
  the controller signal while retaining rejection observation, and prove
  prompt activation rejection/terminal lifecycle/no later Subscribe with a
  never-settling scheduler.

This final bounded correction returns to the existing `implementer`, expected
explicit `gpt-5.6-terra` / `medium`. It changes only the wait race, its focused
regression, and evidence. Clean iterator lanes do not reopen.

## A4.3 review convergence

- The final scheduler correction races even a never-settling injected wait
  against the controller signal while observing the raw promise. Focused
  regression proves prompt activation rejection, no later Subscribe, one
  `failed` terminal notice, and settled client close.
- Targeted TypeScript/API confirmation is clean. Previously clean
  style/maintainability and reliability iterator lanes were unaffected and
  remain clean.
- All accepted P1 findings are resolved. Focused correction evidence passed
  68/68 tests, root typechecking/frozen Proto checks, formatting, and diff
  hygiene. No reviewer-profile mismatch or Spine JVM operation occurred.

## A4.4 documentation-closure review assignments

- Documentation completeness: existing `documentation_reviewer`; immutable
  configured profile `gpt-5.6-luna` / `medium`.
- TypeScript/API documentation: existing `typescript_api_docs_reviewer`;
  expected explicit `gpt-5.6-terra` / `high`.
- Style/maintainability: N/A because A4.4 changes prose/snippets/evidence only
  and all edited Markdown is covered by repository formatting/docs checks.
- Performance/reliability: N/A because A4.4 changes no runtime, scheduling,
  queue, transport, or resource-ownership behavior.

The Desktop surface exposes immutable configured profiles but not independent
runtime self-introspection; visible mismatch invalidates a result. Both
reviewers are read-only and may run focused Spine TS documentation/snippet
checks only. The permanent no-Spine-JVM-execution rule remains in force.

## A4.4 complete review wave and correction batch

Documentation and TypeScript/API concerns completed under the expected
Luna/medium and explicit Terra/high profiles. Independent runtime
self-introspection was unavailable, no visible mismatch occurred, no reviewer
edited files, and no Spine JVM operation occurred.

Accepted findings:

1. P1: cancellation is deduplicated at most once per accepted wire, not once
   globally for a logical subscription that may reconnect across multiple
   wires.
2. P1: update/lifecycle buffer overflow fails both channels directly with the
   shared overflow error; it does not enqueue a lifecycle `failed` notice.
   Other non-cancellation terminal failures do enqueue `failed`.
3. P2: exact bounded remote cleanup is 1,000 ms per accepted wire and must be
   documented.
4. P2: the Event snippet uses an empty Topic that a real server rejects; use a
   valid event target fixture.
5. P2: browser factories select/create transports but their source has no
   platform transport close hook. `Client.close()` closes owned subscription
   work; only injected sources with `close()` close a platform transport.
6. Coordinator precision: state the actual default delay formula: 250 ms
   exponential base, ±20% jitter, and a 5,000 ms final cap; custom returned
   delays remain positive safe integers.

One consolidated prose/snippet correction returns to the existing
`implementer`, expected explicit `gpt-5.6-terra` / `medium`. It may change only
the A4.4 docs/evidence, run the same deterministic docs/snippet gates, and may
not modify runtime, begin later Wave 4 features, commit, push, merge, spawn
children, or execute Spine JVM.

## A4.4 correction evidence and targeted re-review

- The docs now state at-most-once cleanup per accepted wire and the exact
  1,000 ms bound; distinguish direct shared-error overflow from other
  `failed` terminal paths; qualify `closed` as pre-terminal; use the actual
  default backoff formula; build a valid Event target; and describe browser
  transport close ownership accurately.
- Documentation inventory, semantic snippets, browser dependency isolation,
  68 focused tests, formatting, and diff hygiene passed. No runtime or Spine
  JVM work occurred.
- The existing documentation and TypeScript/API reviewers are reopened only
  for their accepted findings. Expected profiles remain immutable
  `gpt-5.6-luna` / `medium` and explicit `gpt-5.6-terra` / `high`.

## A4.4 review convergence

- Targeted documentation completeness re-review is clean across per-wire
  cleanup, the 1,000 ms bound, overflow/terminal distinctions, exact retry
  defaults, valid Event targeting, and browser transport ownership.
- Targeted TypeScript/API documentation re-review is clean for every edited
  identifier, snippet, default, sequence, export/helper distinction, and
  limitation.
- All accepted documentation findings are resolved. Direct coordinator
  `docs:check` passed frozen Proto validation, TypeDoc generation, and exact API
  inventory including 17 client-web exports. Semantic snippets, dependency
  isolation, focused tests, formatting, and diff hygiene are clean. No runtime
  or Spine JVM project operation occurred.

### A4.1 consolidated correction evidence

- The bounded channel now distinguishes graceful `close()` (drain admitted
  values) from cancellation `discard()` (terminal local discard), rejects a
  second pending `next()` deterministically, and preserves one terminal error
  object across both streams. A memoized activation pipeline owns the sole
  `connecting` notification; detached consumer cleanup is contained, and
  cancellation during activation leaves local streams done.
- Focused regressions cover graceful buffered drain, a duplicate pending
  `next()`, concurrent activation's one `connecting` transition, shared error
  identity for update/lifecycle overflow, cancellation's terminal done, and
  exact one-delivery byte reclamation. The Entity authoritative-query factory
  is still not evaluated or compared to the Topic; that remains the explicitly
  recorded A4.3 requirement.
- Public TSDoc now explains retry counting and lifecycle-variant fields. The
  browser guide and client-web README describe current bounded queues/overflow
  while deferring only reconnect, entity resynchronization, gap recovery, and
  signal-lifetime composition. The stale pre-activation test title is fixed
  and the unused `#terminated` promise is removed.
- Fresh evidence: client-web focused suite 1 file / 35 tests; combined web and
  Node focused suite 5 files / 66 tests; scoped client-web coverage 95.42%
  statements, 91.62% branches, 91.46% functions, and 96.45% lines; root
  `typecheck:build`; `docs:check`; semantic snippets; client-web dependency
  isolation; formatting; and diff hygiene passed. No Spine JVM project was
  built, run, generated, or tested.
- Final deterministic API P3 disposition: the first options-validation test
  title no longer claims Entity query-target validation. It now states that
  validation does not evaluate Entity queries, preserving the frozen A4.3
  factory-evaluation and Topic-comparison deferral. This record-only title
  correction does not reopen review lanes.

### A4.1 coverage follow-up

- Behavior-focused public client, Todo, and BlackBox lifecycle coverage raised
  the unrestricted TypeScript coverage result from 8,315/9,252 to 8,331/9,252
  branches (90.0454%). The batch keeps all coverage configuration unchanged and
  adds no production behavior. The sandbox cannot bind the BlackBox loopback
  port (`listen EPERM`); the exact elevated focused run and the elevated full
  TypeScript coverage gate passed. No Spine JVM project was executed.

## B1 auth contract foundation review wave

Coordinator mechanical evidence is clean: focused Vitest passed 3 files / 10
tests; generated TypeScript build/typecheck passed; 40 Proto source checksums
and 49 frozen descriptor digests passed; TypeDoc/API inventories, formatting,
and `git diff --check` passed. No Spine JVM project operation occurred.

### Style/maintainability assignment

- Existing role: `style_maintainability_reviewer`.
- Concern: simplicity, declaration/layout clarity, package boundary, decoder
  maintainability, and avoidance of speculative B2/C abstractions in the B1
  diff.
- Expected model: `gpt-5.6-terra`.
- Expected reasoning: `high`.
- Both fields are explicit in dispatch. Read-only review; no edits, commit,
  push, merge, child dispatch, or Spine JVM execution.

### Documentation assignment

- Existing role: `documentation_reviewer`.
- Concern: auth README/TSDoc/report accuracy, exact B1 limitations,
  informational-not-credential claims, allowlisted transport facts, registry
  fallback behavior, and no unsupported forwarding/session/JVM claims.
- Expected model: `gpt-5.6-luna`.
- Expected reasoning: `medium`.
- Both fields are explicit in dispatch. Read-only review; no edits, commit,
  push, merge, child dispatch, or Spine JVM execution.

### TypeScript/API assignment

- Existing role: `typescript_api_docs_reviewer`.
- Concern: public exports and declarations, exhaustive discriminated request
  contract, generated Protobuf service shape, exact optional typing, registry
  decoding, package export/build shape, compatibility, and extension-seam
  usability.
- Expected model: `gpt-5.6-terra`.
- Expected reasoning: `high`.
- Both fields are explicit in dispatch. Read-only review; no edits, commit,
  push, merge, child dispatch, or Spine JVM execution.

### Deferred/N/A concerns

- Performance/reliability: N/A for B1. This slice introduces contracts and
  bounded synchronous envelope decoding only; it has no concurrency,
  persistence, lifecycle, retry, streaming, cancellation, or resource
  ownership. B2-B4 and C-series runtime slices retain their required
  reliability lanes.
- Security: deferred to the protocol-mandated final Wave 4 release-readiness
  security gate. B1 reviewers still reject obviously unsafe public/serialized
  contracts, but no separate early security role is invoked without a human
  request.

### B1 complete review wave and correction batch

All dispatched profiles match their existing immutable roles: style and
TypeScript/API used explicit `gpt-5.6-terra` / `high`; documentation used
explicit `gpt-5.6-luna` / `medium`. Independent runtime self-introspection is
unavailable on Desktop, and no visible mismatch or inherited fallback
occurred. Reviewers made no edits and performed no Spine JVM operation.

Accepted findings, returned as one batch:

1. P1 API: `packages/proto/test/entrypoints.test.ts` still freezes the
   pre-auth package exports/subpaths. Add and resolve `./auth` /
   `@spine-event-engine/proto/auth`.
2. P2 API: add `@spine-event-engine/auth` to TypeDoc entrypoints and to the
   exact checked API export inventory; the existing docs gate does not yet
   cover the new public package.
3. P2 maintainability/testing: add malformed outer-envelope rejection and
   assert decoded context/target facts for Query, Subscribe, Activate, and
   Cancel rather than checking only discriminants.
4. P2 documentation: state that an `IncomingRequestInput` command variant may
   carry the optional registry; do not imply a separate optional
   `decodeIncomingRequest()` parameter.

The same existing `implementer` receives this complete bounded correction
batch. Expected model `gpt-5.6-terra`, expected reasoning `medium`, both
explicit. It may change only B1 tests, README/TSDoc if needed, TypeDoc/API
inventory/configuration, and B1 evidence. It may not begin B2+, commit, push,
merge, spawn children, or execute any Spine JVM project operation.

### B1 correction evidence and targeted re-review

- Canonical Proto entrypoint coverage now freezes and resolves `./auth`.
  TypeDoc and the API checker now cover the exact 22-export auth package root.
- Malformed outer envelopes and per-kind Query/Subscribe/Activate/Cancel
  target/context facts have focused regressions. README wording now accurately
  locates the optional registry on the command input variant.
- Coordinator evidence passed 4 files / 15 tests, generated build/typecheck, 40
  source checksums, 49 descriptor digests, exact TypeDoc/API inventories,
  formatting, and diff hygiene.
- Reopen only substantively affected concerns:
  - style/maintainability reviewer, expected explicit
    `gpt-5.6-terra` / `high`, for the decoder regressions;
  - TypeScript/API reviewer, expected explicit
    `gpt-5.6-terra` / `high`, for entrypoint and exact inventory closure.
- Documentation wording was a deterministic one-line precision correction and
  is directly confirmed; its otherwise-clean lane is not reopened.
- Review remains read-only with no edits, commit, push, merge, child dispatch,
  or Spine JVM execution.

### B1 review convergence

- Targeted style/maintainability re-review is clean: malformed envelope
  rejection and every non-command request's decoded target/context facts are
  covered.
- Targeted TypeScript/API re-review is clean: the canonical auth Proto subpath
  resolves, its entrypoint test passes, and the exact 22-export auth TypeDoc
  inventory is enforced.
- The documentation precision correction is directly confirmed. All accepted
  B1 findings are resolved.
- Actual role/profile evidence matches every explicit dispatch. Independent
  runtime self-introspection remains unavailable; no visible mismatch or
  inherited fallback occurred.
- No reviewer edited files or performed any Spine JVM operation.

### B1 coverage-found transport correction

- The first post-review full suite passed all 2,637 executed tests but reached
  8,430/9,370 branches (89.96%), three branches below the 90% gate.
- Meaningful auth fallback coverage exposed a real defect: an explicitly
  undefined allowlisted header became an empty request/correlation ID.
  Normalization now omits undefined headers and retains present mixed-case
  allowlisted values; credentials and unknown headers remain excluded.
- Focused fallback tests cover absent message/context/target/topic facts and
  transport optionality. Coordinator verification passed 1 file / 5 tests,
  generated build/typecheck, formatting, and diff hygiene.
- Because production behavior changed, reopen only:
  - style/maintainability for the normalization shape and regression quality,
    expected explicit `gpt-5.6-terra` / `high`;
  - TypeScript/API for exact `TransportRequestContext` observable behavior,
    expected explicit `gpt-5.6-terra` / `high`.
- Both reviews are read-only. No edits, commit, push, merge, child dispatch, or
  Spine JVM execution is permitted.

### B1 transport correction review convergence

- Targeted style/maintainability review is clean for the normalization shape
  and fallback regressions.
- Targeted TypeScript/API review is clean: undefined allowlisted IDs are
  omitted, present IDs are case-insensitive, and credential/unknown headers
  remain excluded.
- Immutable reviewer profiles match explicit Terra/high dispatches;
  independent runtime self-introspection is unavailable and no mismatch was
  visible.
- All B1 review findings are resolved. No reviewer edited files or executed
  Spine JVM.

## B2 unary authentication pipeline review wave

Coordinator evidence is clean: focused auth tests passed 2 files / 12 tests;
generated TypeScript build/typecheck passed; 40 Proto source checksums and 49
descriptor digests passed; TypeDoc enforces the exact 28-export auth inventory;
formatting and diff hygiene passed. No Spine JVM operation occurred.

### Style/maintainability assignment

- Existing role: `style_maintainability_reviewer`.
- Concern: minimal gateway structure, pipeline readability, error/result
  simplicity, clone/rewrite clarity, and avoidance of B3/B4/C scope.
- Expected model: `gpt-5.6-terra`.
- Expected reasoning: `high`.
- Both fields explicit; read-only, no edits/commit/push/merge/children/JVM
  execution.

### TypeScript/API assignment

- Existing role: `typescript_api_docs_reviewer`.
- Concern: public request/result/options/resolver/forwarder contracts, exact
  operation narrowing, context/stale semantics, ResolveContext declarations,
  package inventory, and B4-mappable compatibility.
- Expected model: `gpt-5.6-terra`.
- Expected reasoning: `high`.
- Both fields explicit; read-only, no edits/commit/push/merge/children/JVM
  execution.

### Performance/reliability assignment

- Existing role: `performance_reliability_reviewer`.
- Concern: strict pipeline order, bounded input, no-work/no-forward failures,
  at-most-once forwarding, credential isolation, trusted-clock/context
  replacement, byte preservation, promise rejection behavior, and retained
  resources.
- Expected model: `gpt-5.6-terra`.
- Expected reasoning: `high`.
- Both fields explicit; read-only, no edits/commit/push/merge/children/JVM
  execution.

### Documentation assignment

- Existing role: `documentation_reviewer`.
- Concern: README/TSDoc/report exactness, rejection and ordering claims,
  informational ResolveContext semantics, trusted context, and B2 deferrals.
- Expected model: `gpt-5.6-luna`.
- Expected reasoning: `medium`.
- Both fields explicit; read-only, no edits/commit/push/merge/children/JVM
  execution. Dispatch may wait for surface capacity, but no correction begins
  until the complete four-concern wave returns.

### Security disposition

- Dedicated security review remains deferred to final Wave 4 release readiness
  per protocol. B2's API and reliability reviewers must still reject obviously
  unsafe trust-boundary behavior; no early security role is invoked without a
  human request.

### B2 complete review wave and correction batch

All expected profiles were explicit and match the existing immutable roles:
style, API, and reliability used `gpt-5.6-terra` / `high`; documentation used
`gpt-5.6-luna` / `medium`. Independent runtime self-introspection is
unavailable, with no visible mismatch or fallback. Reviewers made no edits and
performed no Spine JVM operation.

Accepted and deduplicated findings:

1. P1: operation identity is duplicated between top-level routing fields and
   caller-supplied transport facts. Policy/diagnostics can observe a different
   service/method than the gateway forwards. Use one canonical operation source
   and snapshot only immutable allowlisted transport facts before any await;
   runtime extra/credential fields must not survive.
2. P1: the mutable decoded request is shared with authorization and context
   collaborators. Either can alter actor/tenant to bypass stale rejection or
   change fields later forwarded. Isolate collaborator views and preserve an
   untouched source plus requested-identity snapshot for stale comparison and
   rewrite.
3. P1: `AuthorizedRequestContext.timestamp` is ignored and the clock is read a
   second time, allowing forwarded trusted context to differ from what the
   resolver authorized. Make the resolver-returned timestamp authoritative
   (using the injected clock during resolution) and test a changing clock.
4. P2: move the B2 gateway/runtime contracts from the now-mixed 500-line barrel
   into a semantic `src/gateway/` module; keep the package root a public
   re-export.
5. P2: remove the test's `as never` contract bypass and assert exact
   `request-too-large`, `malformed-request`, and `unknown-operation` results.
6. P2: add actual unknown-Protobuf-field preservation and collaborator/forward
   promise-rejection/no-later-work/no-retry regressions.
7. P2 documentation: state the now-authoritative trusted timestamp rule and
   byte-equivalent preservation of every non-ActorContext envelope field.

One consolidated correction batch returns to the replacement existing
`implementer`, expected explicit `gpt-5.6-terra` / `medium`. It owns only
`packages/auth/**`, auth API inventory, B2 report/evidence, and must use RED
regressions first. It may not begin B3+, commit, push, merge, spawn children, or
execute Spine JVM.

### B2 correction evidence and targeted re-review

- Canonical route-bound transport facts, collaborator decode isolation,
  untouched rewrite/identity sources, resolver-authoritative timestamps,
  unknown-field preservation, exact rejections/no-retry tests, semantic gateway
  module, README claims, and API inventory corrections are present.
- Coordinator evidence passed 2 files / 15 tests, generated build/typecheck, 40
  source checksums, 49 descriptor digests, exact 28-export auth TypeDoc
  inventory, formatting, and diff hygiene.
- Reopen the four affected concerns with their original explicit profiles:
  style/API/reliability use `gpt-5.6-terra` / `high`; documentation uses
  `gpt-5.6-luna` / `medium`. Capacity may sequence documentation, but no new
  correction begins until the complete targeted wave returns.
- Re-review is read-only. No edits, commit, push, merge, child dispatch, or
  Spine JVM execution.

### B2 targeted re-review remaining batch

- Documentation is clean. Resolver-authoritative time, unknown/non-context
  field preservation, rejection/ResolveContext behavior, and deferrals are
  accurate.
- Style confirms timestamp ownership and typed exact-rejection tests are
  closed, but finds a P2 runtime import cycle between the public barrel and
  gateway implementation.
- API and reliability deduplicate one remaining P1: the nominal transport
  snapshot is mutable and shared by authorization and context resolution.
  Freeze and/or independently clone allowlisted facts per collaborator and
  prove mutation cannot change later facts.
- Reliability P1: after the first await, later decodes still read the
  caller-owned mutable request byte buffer. Take one private byte snapshot
  immediately after the bound check and use it throughout; test a pending
  session/mutation interleaving.
- Reliability P2: explicitly cover rejected session, authorization, and context
  promises with no later work; forward rejection/no retry is already covered.
- API P2: restore TSDoc for every public gateway request/options/forward/result
  and rejection declaration, including operation identity, byte ownership,
  rejection meanings, and B4 mapping.
- One final bounded correction returns to the replacement `implementer`,
  expected explicit `gpt-5.6-terra` / `medium`. It may change only auth
  modules/tests/docs/inventory/evidence, may not begin B3+, commit, push, merge,
  spawn children, or execute Spine JVM.

### B2 final correction evidence

- Gateway runtime no longer imports the public barrel; one private byte snapshot
  feeds all decodes and rewrite; each collaborator receives independently
  frozen canonical transport facts.
- Pending-session buffer mutation and session/authorization/context/forward
  promise rejection regressions prove stable ownership, original error
  propagation, exact stopping points, and no retry.
- Public gateway declarations have restored TSDoc. Documentation's already
  clean lane is unchanged.
- Coordinator evidence passed 2 files / 17 tests, generated build/typecheck, 40
  source checksums, 49 descriptor digests, exact 28-export TypeDoc inventory,
  formatting, and diff hygiene.
- Reopen only style, API, and reliability for their remaining findings, each
  under the original explicit `gpt-5.6-terra` / `high` profile. Read-only; no
  edits, commit, push, merge, children, or Spine JVM execution.

### B2 final targeted findings

- No remaining runtime P1 defect was found. The cycle, byte ownership,
  transport isolation implementation, timestamp, mutation, unknown-field, and
  covered rejection paths are correct.
- API P1 / reliability P2: add the explicitly required policy-side transport
  mutation attempt and prove context resolution receives an independent frozen
  canonical snapshot.
- Reliability P2: add `ContextResolver.resolveContext()` rejection coverage
  proving one session call, one context-resolution call, no policy/forwarding,
  and no retry.
- Style P2: remove duplicated command/query parsing by making the semantic
  request module the single `decodeIncomingRequest` implementation, re-exported
  by the public root and directly consumed by the gateway.
- Return these narrow changes to the replacement `implementer`, expected
  explicit `gpt-5.6-terra` / `medium`; no B3+, commit, push, merge, child
  dispatch, or Spine JVM execution.

## B3 atomic subscription ownership review wave

- Coordinator evidence passed 3 auth files / 21 tests, generated
  build/typecheck, 40 source checksums, 49 descriptor digests, exact 34-export
  auth TypeDoc inventory, formatting, and diff hygiene.
- Style/maintainability: existing reviewer, expected explicit
  `gpt-5.6-terra` / `high`; inspect store/gateway simplicity, semantic layout,
  and avoidance of premature B4/C scope.
- TypeScript/API: existing reviewer, expected explicit
  `gpt-5.6-terra` / `high`; inspect injectable store contract, public/private
  subscription identities, B4-mappable authorized backend access, result
  types, and compatibility.
- Performance/reliability: existing reviewer, expected explicit
  `gpt-5.6-terra` / `high`; inspect atomic transitions/races, ownership/tenant/
  expiry checks, stale-context handling, clock snapshots, copies/zeroization,
  idempotent cleanup, rejection propagation, and retained resources.
- Documentation: existing reviewer, expected explicit
  `gpt-5.6-luna` / `medium`; inspect README/TSDoc/report claims and B3/B4
  boundary.
- All reviews are read-only with no edits, commit, push, merge, child dispatch,
  or Spine JVM execution. Security remains the final Wave 4 release gate; the
  B3 API/reliability lanes still reject unsafe trust-boundary behavior.

### B3 complete review wave and correction batch

- Expected explicit profiles matched all immutable roles: style/API/reliability
  used `gpt-5.6-terra` / `high`; docs used `gpt-5.6-luna` / `medium`.
  Independent runtime self-introspection is unavailable, with no visible
  mismatch. No reviewer edited files or executed Spine JVM.
- Accepted findings:
  1. P1: use an untouched private byte source, identity snapshot, and
     independent decoded/frozen collaborator views; reject stale actor/tenant
     on every operation and rewrite Subscribe/Activate/Cancel context with a
     fresh trusted value before any backend callback/public topic.
  2. P1: replace the concrete store dependency with an injectable atomic store
     contract. Authorized transitions return defensive backend-envelope copies
     only to injected B4-mappable backend callbacks; browser/public results
     never contain them.
  3. P1: use one coherent clock snapshot, reject already-expired sessions
     before backend work, support optional single-tenant context, and purge all
     expired bindings lazily on gateway activity plus explicit store close so
     abandoned payloads are not retained indefinitely. There is no background
     timer and docs must say so.
  4. P1: if backend Subscribe succeeds but store creation fails, invoke the
     injected backend cancellation/cleanup seam. Activate/Cancel callback
     failures must have deterministic state/cleanup and never leak a binding or
     payload.
  5. P2: move the subsystem under `src/subscriptions/`, keep the root a public
     re-export, and add stale/rewrite/mutating-collaborator, expiry-at-Subscribe,
     moving-clock, backend/store rejection, callback cleanup, unattended purge,
     shutdown close, defensive-copy, race, and zero-retention regressions.
- One consolidated correction returns to the replacement `implementer`,
  expected explicit `gpt-5.6-terra` / `medium`. It owns only auth B3
  modules/tests/docs/inventory/evidence; no B4 native implementation, C+,
  commit, push, merge, children, or Spine JVM execution.

### B3 correction re-review assignments

- Coordinator verification passed 3 auth files / 26 tests, the auth package
  typecheck, exact 35-export TypeDoc/API inventory, formatting, and diff
  hygiene.
- Style/maintainability re-review uses the existing
  `style_maintainability_reviewer`, expected explicit `gpt-5.6-terra` /
  `high`, limited to the semantic module move, collaborator isolation,
  context-rewrite clarity, and correction maintainability.
- TypeScript/API re-review uses the existing
  `typescript_api_docs_reviewer`, expected explicit `gpt-5.6-terra` / `high`,
  limited to injectable store/public contracts, optional tenant semantics,
  private backend envelope ownership, and B4-mappable callbacks.
- Performance/reliability re-review uses the existing
  `performance_reliability_reviewer`, expected explicit `gpt-5.6-terra` /
  `high`, limited to atomic transitions, one-clock behavior, stale identity,
  expiry/purge/close, defensive copies, failure cleanup, races, and retained
  resources.
- Documentation re-review uses the existing `documentation_reviewer`,
  expected immutable `gpt-5.6-luna` / `medium`, limited to lazy expiry/no
  background timer, ownership/rewriting claims, and the B3/B4 boundary.
- The Desktop dispatch adapter rejected a redundant explicit
  `gpt-5.6-luna` override because only Sol/Terra are accepted as override
  values; the existing `documentation_reviewer` role itself immutably
  configures Luna/medium. The re-dispatch therefore names that fixed role
  explicitly and relies on its immutable configured profile. Independent
  runtime self-introspection remains unavailable; this surface limitation is
  recorded rather than misreporting a Terra substitution.
- All dispatches set model and reasoning explicitly and are read-only: no
  edits, commit, push, merge, child dispatch, or Spine JVM build, test,
  generation, dependency resolution, launch, or project execution.

### B3 correction re-review results and second correction batch

- Style, TypeScript/API, and performance/reliability ran under their explicit
  immutable existing roles with the expected `gpt-5.6-terra` / `high`
  profile. Independent runtime self-introspection was unavailable; no
  mismatch or fallback was visible. Reviews were read-only and performed no
  Spine JVM execution.
- Accepted reliability findings:
  1. serialize or lease activation and cancellation backend effects so a
     delayed Activate cannot complete after Cancel and leave unowned live
     backend work; test both callback orderings;
  2. retain retry-safe cancellation state/envelope until backend cleanup
     succeeds, make the required cleanup seam non-optional, and prove retry
     after rejection;
  3. make store close terminal so concurrent or late creation cannot retain a
     backend envelope after shutdown;
  4. capture transport facts once at admission and derive independent
     collaborator snapshots from that stable source.
- Accepted style/test findings: split the 67-line security pipeline into named
  preparation/operation phases and replace the misleading defensive-copy test
  with mutations that prove source/store/callback byte isolation.
- Accepted API finding: the trusted infrastructure store contract currently
  exposes backend envelopes through ordinary exported transition results.
  Redesign the store/gateway seam so only gateway-controlled native callbacks
  receive transition bytes, while retaining an injectable store abstraction
  and an in-memory reference implementation. Public/browser gateway results
  must remain opaque.
- Accepted API-documentation finding: use named/discriminated raw-wire inputs
  for Topic, public Subscription, and opaque backend bytes; document exact RPC,
  optional-tenant, ownership/copy, result, and callback failure semantics.
- Inventory adjudication: the coordinator's generated TypeDoc check reports
  exactly 35 auth exports and the inventory contains 35 names. The B3 report's
  stale “34” claim must be corrected; the review log's “35” evidence is
  accurate.
- Documentation ran through the immutable existing `documentation_reviewer`
  role at its fixed `gpt-5.6-luna` / `medium` profile after the adapter
  rejected a redundant Luna override. Independent runtime self-introspection
  was unavailable; no visible mismatch occurred. It found two P2 defects:
  correct the stale 34-export claims in the B3 report/work log, and add exact
  public TSDoc for raw-wire shapes, optional tenant matching, copy ownership,
  opaque results, and callback cleanup/failure semantics. Other README claims
  and the B3/B4 boundary are accurate.
- One fresh existing `implementer` receives this complete batch. Expected
  explicit model `gpt-5.6-terra`, reasoning `medium`; both dispatch fields are
  set. Ownership is limited to B3 auth runtime/tests/docs/API inventory and
  durable B3 evidence. It may not begin B4/C+, commit, push, merge, spawn
  children, or execute Spine JVM.

### B3 second-correction verification and re-review

- Coordinator verification passed 3 auth files / 25 tests, auth package
  typecheck, exact 35-export TypeDoc/API inventory, formatting, and diff
  hygiene.
- Reopen style/maintainability, TypeScript/API, and
  performance/reliability with fresh existing reviewer roles, each expected
  explicit `gpt-5.6-terra` / `high`. Documentation follows under the existing
  immutable `gpt-5.6-luna` / `medium` role.
- Re-review is limited to the complete accepted correction batch and
  regressions. All dispatches are read-only with no edits, commit, push,
  merge, children, or Spine JVM execution.

### B3 second-correction re-review findings

- Style/API/reliability used fresh existing reviewer roles with explicit
  `gpt-5.6-terra` / `high`; independent runtime self-introspection was
  unavailable with no visible mismatch. Reviews were read-only and performed
  no Spine JVM execution.
- Accepted P1 correctness/API findings:
  1. copy and normalize route, wire bytes, credential, and transport facts
     synchronously at `handle()` admission before any queued/awaited work;
  2. make gateway-controlled backend transition callbacks mandatory and add a
     private-envelope-only compensation seam for Subscribe success followed by
     binding-create failure, including compensation-failure evidence;
  3. export every named wire/envelope/callback type used by public contracts
     and freeze its exact TypeDoc inventory;
  4. replace gateway-wide/store-wide promise chains with bounded per-binding
     coordination so a hung backend effect cannot block unrelated bindings or
     retain an unbounded queue; define finite queue/shutdown behavior and test
     independent bindings plus overflow;
  5. add finite admission-wire, backend-envelope, and retained-binding limits
     before copying/retaining bytes, with deterministic rejection and cleanup.
- Accepted P2 style/test/evidence findings: split the still-63-line security
  pipeline into named preparation and operation phases; mirror the semantic
  test folder; restore both Activate/Cancel orderings, owner/tenant/expiry and
  stale Activate/Cancel regressions; prove queued-input mutation, pre-binding
  cleanup success/failure, independent binding progress, queue bounds,
  defensive copies, terminal close, and zero retention; correct the stale
  focused-test count and any overclaims.
- Documentation re-review is assigned to the existing immutable
  `documentation_reviewer` (`gpt-5.6-luna` / `medium`, adapter limitation
  already recorded), limited to claims affected by these findings. Read-only;
  no edits or Spine JVM execution.
- Documentation completed under that immutable profile and confirmed the
  current README/TSDoc/report overclaim immediate admission, mandatory cleanup,
  and complete serialization; omit finite limits/overflow/shutdown and
  compensation; and describe named wire types not exported by the root. The
  final 3-file/25-test count is accurate; older counts are historical.

### B3 bounded-correction mechanical rejection

- Independent focused tests and auth typecheck passed 3 files / 28 tests, but
  generated docs/API checking failed because exported
  `SubscriptionAbortSignal` is absent from the frozen auth inventory.
- Coordinator inspection also found accepted design items still mechanically
  absent: expiry purge and terminal close do not call mandatory private
  disposal; successful timeout races leave live timers that can later abort a
  reused binding controller; close does not own per-binding cleanup; the
  security pipeline remains over 35 lines; and tests were not moved under the
  mirrored `test/subscriptions/` folder.
- These are deterministic omissions from the already accepted design, not a
  new review wave. They return to the same existing implementation context,
  expected unchanged explicit `gpt-5.6-terra` / `medium`, before specialist
  review. No B4/C+, commit, push, merge, children, or Spine JVM execution.

### B3 final bounded verification and review assignments

- Coordinator verification passed 3 auth files / 33 tests, auth typecheck,
  exact 41-export TypeDoc/API inventory, formatting, and diff hygiene.
- Final style/maintainability, TypeScript/API, and performance/reliability
  re-reviews use fresh existing roles with explicit `gpt-5.6-terra` / `high`.
  Documentation follows under the immutable existing
  `documentation_reviewer` (`gpt-5.6-luna` / `medium`; adapter limitation
  already recorded).
- The final reliability lens includes callback timeouts for Subscribe and
  compensation, expiry racing active/queued work, bounded aggregate close,
  capacity/queue limits, copies/zeroing, and independent binding progress.
- All reviews are read-only with no edits, commit, push, merge, children, or
  Spine JVM build, test, generation, dependency resolution, launch, or project
  execution.

### B3 final bounded review results and correction

- Style/API/reliability ran through fresh existing roles with explicit
  `gpt-5.6-terra` / `high`. Documentation ran through the immutable existing
  `gpt-5.6-luna` / `medium` role under the recorded adapter limitation.
  Independent runtime self-introspection was unavailable; no visible mismatch
  or fallback occurred. All reviews were read-only and executed no JVM work.
- Accepted P1 correction batch:
  1. bound `creator.subscribe` and every pre-binding `dispose` compensation by
     `operationTimeoutMs`, abort on timeout, clear timers, and zero every
     B3-owned copy; use a standard event-capable `AbortSignal` suitable for B4;
  2. export/name the binding transition result and every public signature type;
  3. validate owner/tenant before queue reservation and recheck inside the
     coordinator; foreign Cancel is denied (not idempotent success) and consumes
     no pending slot;
  4. coordinate expiry with running/queued operations so disposal cannot race a
     live activation into unowned backend work;
  5. reserve finite binding capacity before backend Subscribe, release the
     reservation on every failure, and prevent concurrent in-flight creations
     from exceeding `bindingLimit`.
- Accepted P2 correction batch: perform real ≤35-line method decomposition;
  add gateway-level admission/collaborator mutation and stale
  Subscribe/Activate/Cancel coverage; add true concurrent cancel-first,
  unauthorized queue, Subscribe/compensation timeout+abort, expiry-versus-
  active/queued, close-abort, capacity-reservation, failure/zeroing tests;
  update exact API inventory and truthful evidence. Docs must state standard
  AbortSignal/cooperative callback limits and use serialized-tenant-fingerprint
  wording.
- One fresh existing `implementer` owns this single final B3 correction,
  expected explicit `gpt-5.6-terra` / `medium`. B3 auth runtime/tests/docs/API
  inventory/evidence only; no B4/C+, commit, push, merge, children, or Spine JVM
  execution.

### B3 final-correction verification and targeted acceptance

- Coordinator verification passed 3 auth files / 36 tests, auth typecheck,
  exact 43-export TypeDoc/API inventory, formatting, and diff hygiene.
- Reopen only correction-affected style, TypeScript/API, reliability, and
  documentation concerns under their already explicitly dispatched immutable
  profiles. Reviews remain read-only with no edits, commit, push, merge,
  children, or Spine JVM execution.

### B3 targeted final findings

- API P1: export the actual platform `AbortSignal` type, not a reduced
  module-private lookalike; B4 must be able to pass it directly to standard
  abort-aware APIs.
- Reliability P1: terminal close must also own, abort, settle, and release
  in-flight pre-binding Subscribe reservations/controllers within the global
  shutdown bound.
- Style/test P2: remove the forwarding-only wrapper and split actual
  `#perform`/`#subscribe` responsibilities below 35 lines. Add true
  interleavings for queued foreign owner and tenant denial, pending gateway
  input/transport mutation and stale Activate/Cancel, Subscribe and
  compensation timeout/abort/reservation release, concurrent cancel-first,
  expiry-versus-active/queued, and close-aborts-active work.
- Documentation P2: use serialized-tenant-fingerprint wording and remove or
  explicitly supersede the stale 33-test/41-export evidence block.
- One existing `implementer`, expected explicit `gpt-5.6-terra` / `medium`,
  owns this tightly scoped final correction. No B4/C+, commit, push, merge,
  children, or Spine JVM execution.

### B3 last targeted correction

- API acceptance is clean: the exported signal now aliases the actual platform
  `AbortSignal`.
- Reliability P1: race pending Subscribe and its pre-binding compensation
  against the gateway-owned abort event as well as the operation timeout, so
  `close()` settles the public handle and zeros admitted bytes within
  `shutdownTimeoutMs`; compensation must use/track the same close-owned
  controller rather than an untracked one.
- Style/reliability P2: remove the redundant forwarding-only `#handle` wrapper.
  Add real gateway/interleaving regressions for a queued foreign owner and
  tenant consuming no slot, pending caller wire/transport mutation,
  stale Activate and Cancel, Subscribe timeout+abort+reservation release,
  compensation timeout+abort, concurrent cancel-first, expiry-versus-active
  and queued work, close-aborts-active work, and close settlement of the
  pending Subscribe handle. Correct report wording/evidence accordingly.
- Return this narrow batch to the existing `implementer` under its original
  explicit `gpt-5.6-terra` / `medium` dispatch. No B4/C+, commit, push, merge,
  children, or Spine JVM execution.

### B3 terminal race correction

- The exact eight-test matrix is present and passes. Remaining findings are
  limited to:
  1. ensure post-Subscribe/pre-binding compensation receives a fresh usable
     controller even when gateway close already aborted the Subscribe
     controller, while remaining bounded by shutdown;
  2. add the close-versus-just-completed-Subscribe compensation regression;
  3. reduce `#subscribe` from 37 to at most 35 lines;
  4. prove timed-out compensation releases a capacity-one lease with a
     successful follow-up Subscribe;
  5. mark the initial 33-test/41-export block historical/superseded by 45/43.
- Return this minimal correction to an existing `implementer` under explicit
  `gpt-5.6-terra` / `medium`. No B4/C+, commit, push, merge, children, or Spine
  JVM execution.

### B3 terminal-race acceptance assignments

- Independent coordinator verification passed 3 auth files / 47 tests, auth
  typecheck, generated TypeDoc/API checking with the frozen 43-export
  inventory, formatting, and diff hygiene.
- Final style/maintainability acceptance uses the existing
  `style_maintainability_reviewer` role with explicit `gpt-5.6-terra` /
  `high`, limited to the corrected `#subscribe` decomposition and the
  capacity-one follow-up regression.
- Final performance/reliability acceptance uses the existing
  `performance_reliability_reviewer` role with explicit `gpt-5.6-terra` /
  `high`, limited to close versus just-completed Subscribe, live bounded
  compensation, lease release, and zero retained bindings.
- Final documentation acceptance uses the existing `documentation_reviewer`
  role with its immutable `gpt-5.6-luna` / `medium` profile. The Desktop
  adapter does not accept a redundant model override for this fixed role; the
  immutable configured profile is the available evidence. Its scope is the
  historical/superseded evidence wording and final 47-test/43-export claims.
- All three reviews are read-only. They may not edit, commit, push, merge,
  spawn children, or execute any Spine JVM project command.

### B3 terminal-race acceptance results

- Style/maintainability is clean. `#subscribe` is meaningfully decomposed
  below the 35-line limit, and the capacity-one follow-up test proves the
  operation-timeout compensation path releases its lease.
- Documentation is clean. The 33-test/41-export checkpoint is explicitly
  historical and superseded; the current evidence consistently records 47
  tests and the frozen 43-export inventory.
- Performance/reliability accepted one P2 regression gap: the
  close-versus-completed-Subscribe test proves the fresh compensation signal
  starts live, but does not prove a hung disposer is aborted at
  `shutdownTimeoutMs`, the public handle settles, capacity is reusable, and no
  binding remains.

### B3 terminal-race P2 regression closure

- The accepted P2 regression now holds pre-binding creation, closes after
  Subscribe completes, then holds mandatory disposal. It proves the fresh
  compensation signal starts live, aborts at `shutdownTimeoutMs`, settles the
  public handle, releases the capacity-one reservation, and leaves no binding.
- No production change was required: the existing fresh-controller and bounded
  compensation implementation satisfied the stronger interleaving.
- The existing `implementer` owns that single test/evidence correction under
  its original explicit `gpt-5.6-terra` / `medium` assignment. No production
  redesign, B4/C+, commit, push, merge, child dispatch, or Spine JVM project
  command is permitted.

### B3 reliability P2 correction verification

- The existing implementer completed the test-only correction under its
  original explicit `gpt-5.6-terra` / `medium` dispatch. Independent runtime
  self-introspection remains unavailable; the immutable configured role/profile
  shows no mismatch or fallback.
- Independent coordinator verification passed 3 auth files / 47 tests, auth
  typecheck, generated TypeDoc/API checking with the 43-export inventory,
  formatting, and diff hygiene.
- Re-review reopens only performance/reliability under the existing
  `performance_reliability_reviewer` role and its original explicit
  `gpt-5.6-terra` / `high` assignment. It is limited to the new
  close-raced hung-disposer regression and remains read-only with no commit,
  push, merge, children, or Spine JVM project command.

### B3 final review disposition

- Performance/reliability re-review is clean. The new regression proves the
  fresh compensation signal starts live, aborts at `shutdownTimeoutMs`, the
  pending handle settles, the capacity-one reservation is reusable, and no
  binding remains.
- Style/maintainability: clean.
- Documentation completeness: clean.
- TypeScript/API docs: clean from the preceding targeted acceptance; the
  test-only reliability correction changed no public contract.
- Performance/reliability: clean.
- All dispatched models/reasoning were explicit except the immutable
  documentation role's recorded Desktop adapter limitation. No visible role,
  profile, or fallback mismatch occurred. B3 review is converged.

### B3 full-gate coverage correction

- The sandboxed full gate was mechanically invalid for network/IPC acceptance:
  187 tests failed with explicit loopback-listener and ZeroMQ IPC `EPERM`
  errors. The identical unrestricted TypeScript gate then passed every runnable
  test: 144 files / 2,681 tests, with 25 skipped.
- The unrestricted gate still failed the branch threshold at 89.77%
  (8,637/9,621). The new subscription module reports 77.43% branch coverage
  and exposes a focused test gap; production correctness review remains clean.
- The existing `implementer` owns behavior-focused B3 test expansion under its
  original explicit `gpt-5.6-terra` / `medium` assignment. It must cover real
  uncovered outcomes until the global branch gate is at least 90%, without
  threshold changes, ignore annotations, production redesign, B4/C+, commit,
  push, merge, children, or Spine JVM project execution.

### B3 full-gate acceptance

- The implementer added four behavior-focused subscription tests without
  changing production code, coverage thresholds, or ignore directives.
  Independent focused verification passed 3 auth files / 51 tests, auth
  typecheck, generated TypeDoc/API checking, formatting, and diff hygiene.
- The first unrestricted full-gate rerun encountered one transient existing
  delivery-client child-readiness timeout; its isolated file immediately
  passed 3/3. The repeated full unrestricted gate passed 144 runnable files /
  2,685 tests with 25 skipped.
- Final coverage is 94.07% statements, 90.00% branches (8,659/9,621), 94.30%
  functions, and 94.79% lines. The subscription module is 88.71% branches.
- B3 is mechanically verified and review-converged. No Spine JVM project
  command was run.

### B3 coverage test expansion

- Four gateway/store behavior tests now cover terminal and malformed routing,
  invalid time, unauthenticated/forbidden/expired security outcomes, optional
  trusted context plus present allowlisted transport facts, invalid backend/ID
  storage inputs, and public capacity-failure mapping. No production code,
  threshold, or coverage-ignore configuration changed.
- Focused coverage reports `subscriptions/index.ts` at 88.71% branches, up from
  77.43%, adding 22 exercised branches. Applied to the unrestricted baseline,
  this is 8,659/9,621 branches, exactly 90.00%. The local unrestricted rerun
  returned successfully but emitted neither a final coverage summary nor an
  LCOV artifact, so that post-change global total remains arithmetic evidence
  pending the coordinator's next unrestricted report.

## B4 native forwarding review assignments

- Style/maintainability: existing `style_maintainability_reviewer`, expected
  and explicitly dispatched `gpt-5.6-terra` / `high`. Scope is the B3 update
  sink seam, native adapter/module shape, handler and relay clarity, ownership,
  tests, and avoidance of speculative abstractions.
- TypeScript/API docs: existing `typescript_api_docs_reviewer`, expected and
  explicitly dispatched `gpt-5.6-terra` / `high`. Scope is public exports,
  Connect descriptor/runtime agreement, declarations, browser-safe contracts,
  error mapping, and generated API inventory.
- Performance/reliability: existing `performance_reliability_reviewer`,
  expected and explicitly dispatched `gpt-5.6-terra` / `high`. Scope is finite
  relay bounds, FIFO/backpressure, abort propagation, iterator termination,
  failure convergence, cleanup, retention, and backend-call ownership.
- Documentation: existing `documentation_reviewer` with its immutable
  `gpt-5.6-luna` / `medium` profile. Desktop does not accept a redundant model
  override for this fixed role; this limitation and the immutable configured
  profile are the dispatch metadata. Scope is package README, TSDoc, limits,
  lifecycle claims, API inventory, and B4 evidence.
- Independent runtime self-introspection is unavailable. Explicit dispatch and
  immutable configured role/profile are the acceptance metadata unless a
  visible mismatch or fallback appears. All reviewers are read-only, may not
  edit, commit, push, merge, spawn children, begin C+, or execute any Spine JVM
  project command. They must return `CLEAN` or exact P0-P2 findings.

Pre-review mechanical evidence is 5 auth files / 85 tests, auth TypeScript
typecheck, generated TypeDoc/API checking, Prettier, and `git diff --check`,
all independently passing.

### B4 complete review wave

Runtime metadata:

- Style/maintainability, TypeScript/API docs, and performance/reliability ran as
  their existing roles under explicitly dispatched `gpt-5.6-terra` / `high`.
- Documentation ran as the existing immutable `gpt-5.6-luna` / `medium` role;
  Desktop cannot accept a redundant override for that fixed role.
- Independent self-introspection was unavailable. No visible role/profile
  mismatch or inherited fallback occurred. No reviewer edited files or ran a
  Spine JVM project command.

Accepted, deduplicated correction batch:

- P1: reject an already-aborted downstream Activate before any B3/native
  activation starts, and make the injected `SubscriptionBindings` contract
  explicitly require propagation of the admitted signal to its active effect.
  Prove the real B3 gateway/in-memory binding path makes zero native Activate
  calls for a pre-aborted request.
- P1: natural native-stream completion must converge through bounded B3
  cancellation/disposal, remove the binding, and retain no relay queue. A later
  context abort or iterator `return()`/`throw()` must be able to supersede
  graceful drain and purge buffered updates.
- P1: carry `HandlerContext.signal` through `UnaryGateway` and `UnaryForwarder`
  to native Post/Read Connect calls. Prove aborted and non-cooperative unary
  work is cancelled without losing B2 security/copy semantics.
- P1: a live activation must terminate when its admitted ActorContext session
  expires, abort its native effect, perform bounded cleanup, and retain no
  binding; expiry cannot depend on a later unrelated request.
- P1: malformed backend update bytes must terminally fail the relay, reject any
  pending consumer, purge queued bytes, and abort B3 work. Cover both a waiting
  consumer and a queued malformed update.
- P2: use distinct non-empty update payloads to prove copied bytes and FIFO
  order in both relay and handler tests.
- P2: document the complete terminal lifecycle in `packages/auth/README.md`,
  including disconnect, context abort, iterator termination, expiry, explicit
  Cancel, normal completion, backend/gateway error, gateway close, and overflow.
- P2: expand public native TSDoc for relay defaults, independent count/byte
  bounds, validation, `ResourceExhausted`, graceful drain versus failure purge,
  iterator cancellation, creator descriptor mappings and AbortSignals,
  request-context extractors, service properties, and named factory options.

All four concerns reopen because the P1 contract/lifecycle changes affect
public declarations, reliability, structure, and documentation. One bounded
implementation owner receives this single correction batch before targeted
re-review.

### B4 correction verification and re-review assignments

- The implementer completed the accepted batch under explicit
  `gpt-5.6-terra` / `medium`. Independent self-introspection was unavailable;
  the immutable role/profile showed no mismatch or fallback.
- Independent coordinator verification passed 5 auth files / 93 tests, auth
  TypeScript typecheck, generated TypeDoc/API checking, Prettier, and
  `git diff --check`.
- Style/maintainability reopens under the existing
  `style_maintainability_reviewer`, explicitly `gpt-5.6-terra` / `high`.
- TypeScript/API docs reopens under the existing
  `typescript_api_docs_reviewer`, explicitly `gpt-5.6-terra` / `high`.
- Performance/reliability reopens under the existing
  `performance_reliability_reviewer`, explicitly `gpt-5.6-terra` / `high`.
- Documentation reopens under the existing immutable
  `documentation_reviewer` profile, `gpt-5.6-luna` / `medium`; Desktop cannot
  accept a redundant fixed-role override.
- Re-review is limited to the accepted correction batch and its direct
  effects. All reviewers are read-only, may not edit, commit, push, merge,
  spawn children, begin C+, or execute any Spine JVM project command. Runtime
  self-introspection is unavailable; explicit dispatch and immutable profile
  are the metadata evidence.

### B4 targeted re-review results

All four reviewers ran under the recorded explicit or immutable profiles.
Independent self-introspection remained unavailable; no visible mismatch or
fallback occurred.

Accepted final correction batch:

- P1: after an Activate waits behind a prior binding operation, re-check its
  admitted expiry/abort signal before changing state or starting native work.
  Add a forced interleaving where the queued Activate expires while waiting and
  prove zero native invocation.
- P2: reflow the three authored package/test lines over 120 columns.
- P2: add `NativeGatewayServicesOptions` to the frozen auth API inventory.
- P2: qualify README zero-retention claims: natural completion, overflow,
  malformed/backend failure, explicit Cancel, disconnect, and expiry remove the
  binding after successful cleanup; a failed cleanup deliberately retains the
  private binding in retryable cancelling state for a later authorized Cancel.
- P2: finish public native TSDoc for every `NativeSubscriptionCreator` method,
  request-context extractor, service-bundle property, factory/status mapping,
  relay iterator cancellation, and graceful-drain versus failure-purge
  behavior.

The distinct non-empty copy/FIFO correction is accepted. Reliability reopens
for the P1 interleaving; style, TypeScript/API docs, and documentation reopen
for their respective deterministic P2 corrections.

### B4 complete-review correction implementation evidence

- The assigned existing `implementer` completed the entire accepted batch under
  explicit `gpt-5.6-terra` / `medium` dispatch. Runtime self-introspection is
  unavailable; immutable configured role/profile and explicit dispatch are the
  available metadata, with no visible mismatch or fallback.
- RED/GREEN coverage now proves pre-aborted B3/native prevention, active-effect
  abort contract, bounded normal-completion cleanup/removal, drain supersession,
  unary abort forwarding, live expiry, malformed-update terminal purge, and
  distinct non-empty copied FIFO payloads.
- README and public TSDoc/nameable factory options describe the correction
  semantics. Focused auth tests (5 files / 92), auth typecheck, generated
  TypeDoc/API checking, Prettier, and diff hygiene pass. No Spine JVM project
  command ran. The four reopened concerns await their targeted re-review.

### B4 targeted re-review final correction implementation

- The existing `implementer` completed the accepted final batch under explicit
  `gpt-5.6-terra` / `medium` dispatch. Independent self-introspection remains
  unavailable; immutable configured role/profile and dispatch are the metadata
  evidence, with no visible mismatch or inherited fallback.
- RED/GREEN proves a queued real in-memory B3 Activate that aborts while behind
  a first failed operation re-checks its admitted signal after the queue await,
  returns `denied`, and makes zero queued native calls before state transition.
- The deterministic P2 correction reflows overlength authored lines, adds
  `NativeGatewayServicesOptions` to the frozen inventory, distinguishes
  successful cleanup from retryable failed cancellation cleanup in the README,
  and completes the specified public native TSDoc.
- Focused implementation validation passed the subscription file (40 tests).
  Full auth mechanical validation then passed 5 files / 94 tests, auth
  typecheck, generated TypeDoc/API checking, Prettier, and diff hygiene.
  Targeted reviewer re-review remains pending. No Spine JVM project command
  ran.

### B4 final acceptance re-review assignments

- Independent coordinator verification passed 5 auth files / 94 tests, auth
  TypeScript typecheck, generated TypeDoc/API inventory, Prettier, cleanup-rule
  enforcement, and diff hygiene.
- Performance/reliability reopens under the existing reviewer with explicit
  `gpt-5.6-terra` / `high`, limited to the queued-Activate expiry interleaving.
- Style/maintainability reopens under the existing reviewer with explicit
  `gpt-5.6-terra` / `high`, limited to authored line length and accurate
  retention wording.
- TypeScript/API docs reopens under the existing reviewer with explicit
  `gpt-5.6-terra` / `high`, limited to the frozen export inventory and completed
  native TSDoc.
- Documentation reopens under its immutable `gpt-5.6-luna` / `medium` profile,
  limited to cleanup-success versus retryable-failure wording and native TSDoc.
  Desktop cannot accept a redundant fixed-role override.
- All reviews are read-only with no edits, commits, pushes, merges, children,
  C+, or Spine JVM project execution. Runtime self-introspection is unavailable;
  explicit dispatch and immutable profile are the metadata evidence.

### B4 final acceptance results and API documentation correction

- Style/maintainability: clean.
- Performance/reliability: clean.
- Documentation: clean.
- TypeScript/API docs accepted one P2 omission: the factory TSDoc promised
  rejection-to-Connect status mapping without enumerating the public mapping.
  The frozen inventory and all other native TSDoc surfaces are clean.
- This is a deterministic documentation-only correction: enumerate
  Unauthenticated, PermissionDenied, ResourceExhausted, Aborted, Unimplemented,
  and InvalidArgument mappings on `createNativeGatewayServices`. It does not
  change runtime behavior and reopens TypeScript/API docs only.
- Final acceptance re-review uses the existing `typescript_api_docs_reviewer`
  with explicit `gpt-5.6-terra` / `high`, limited to that corrected paragraph.
  It remains read-only with no edits, commits, pushes, merges, children, C+, or
  Spine JVM project execution. Runtime self-introspection is unavailable;
  explicit dispatch and immutable role/profile are the metadata evidence.

### B4 final review disposition

- Style/maintainability: clean.
- Documentation completeness: clean.
- TypeScript/API docs: clean.
- Performance/reliability: clean.
- The final API re-review confirmed that the factory TSDoc accurately
  enumerates every public rejection status category; the unexpected internal
  result remains correctly outside rejection mapping.
- All dispatched model/reasoning profiles were explicit except the documented
  immutable documentation-role limitation. No visible mismatch or fallback
  occurred. B4 specialist review is converged.

### B4 full-gate coverage correction

- Two full-gate attempts encountered unrelated timing/readiness failures; all
  affected files passed immediately in isolation. The third canonical run
  passed all 146 runnable files / 2,728 tests with 25 skipped.
- The third run failed only the branch threshold at 89.99% (8,756/9,729),
  one hundredth below the required 90%. Statements are 94.05%, functions
  94.23%, and lines 94.77%.
- Review correctness remains converged. One existing `implementer` owns
  behavior-focused B4 test expansion for real uncovered branches until the
  global branch threshold is at least 90%, without production changes,
  threshold changes, ignore directives, C+, commit, push, merge, children, or
  Spine JVM project execution.
- Expected model is explicitly `gpt-5.6-terra`; expected reasoning is
  explicitly `medium`. Runtime self-introspection may be unavailable; explicit
  dispatch and immutable role/profile are the acceptance metadata.

### B4 full-gate acceptance

- The implementer added three behavior-only tests for delivery to an already
  waiting relay consumer, push rejection after graceful closure, and unexpected
  Activate acknowledgement mapping to Connect `Internal`. No production,
  threshold, or ignore-directive change was made.
- Independent focused verification passed 5 auth files / 97 tests, auth
  typecheck, generated TypeDoc/API checking, formatting, and diff hygiene.
- The final canonical full gate passed 146 runnable files / 2,731 tests with 25
  skipped. Coverage is 94.08% statements, 90.04% branches (8,760/9,729),
  94.26% functions, and 94.80% lines.
- B4 is mechanically verified and review-converged. No Spine JVM project
  command ran.

## C1 opaque-session review assignments

- Style/maintainability: existing `style_maintainability_reviewer`, expected
  and explicitly dispatched `gpt-5.6-terra` / `high`. Scope is module depth,
  names, ownership, atomic transitions, test maintainability, and avoidance of
  speculative framework/persistence seams.
- TypeScript/API docs: existing `typescript_api_docs_reviewer`, expected and
  explicitly dispatched `gpt-5.6-terra` / `high`. Scope is public contracts,
  result unions, declaration/runtime agreement, root exports, TSDoc, cookie
  serialization contract, and API inventory.
- Performance/reliability: existing `performance_reliability_reviewer`,
  expected and explicitly dispatched `gpt-5.6-terra` / `high`. Scope is finite
  capacity/collision work, lazy expiry, rotate/logout/resolve linearization,
  close/retention, defensive copies, secret ownership, and bounded behavior.
- Documentation: existing immutable `documentation_reviewer`,
  `gpt-5.6-luna` / `medium`; Desktop cannot accept a redundant override for the
  fixed role. Scope is README/TSDoc/report accuracy for sessions, cookies,
  Origin/CSRF, logout, limitations, and future C2/C3/C5 boundaries.
- Security-sensitive findings from these concern reviews are resolved in C1;
  the existing final `security_reviewer` remains reserved for the mandatory
  Wave 4 release gate.
- Independent runtime self-introspection is unavailable. Explicit dispatch and
  immutable configured role/profile are the acceptance metadata unless a
  visible mismatch/fallback appears. All reviewers are read-only, may not edit,
  commit, push, merge, spawn children, begin C2+, or execute any Spine JVM
  project command.

Pre-review mechanical evidence independently passes 6 auth files / 109 tests,
auth typecheck, generated TypeDoc/API inventory, Prettier, cleanup rules, and
diff hygiene.

### C1 complete review wave

Runtime metadata:

- Style/maintainability, TypeScript/API docs, and performance/reliability ran
  under explicitly dispatched `gpt-5.6-terra` / `high`.
- Documentation ran under the immutable `gpt-5.6-luna` / `medium` profile;
  Desktop cannot accept a redundant fixed-role override.
- Independent self-introspection was unavailable. No visible role/profile
  mismatch or inherited fallback occurred. No reviewer edited files or ran a
  Spine JVM project command.

Accepted, deduplicated correction batch:

- P1: parse unrelated cookie values at the first `=` and accept valid padded
  values while retaining exact 43-character base64url constraints for the two
  Spine cookies.
- P1: preserve capacity, close, and old-record atomicity across re-entrant
  injected randomness. Re-check store state, capacity, collision, and the
  original rotation record after every external callback. Add forced
  create/create, create/close, rotate/logout, and rotate/close regressions.
- P1: add forced synchronous call-order tests for rotate/rotate,
  logout/rotate, resolve/rotate, and resolve/logout without awaiting the first
  returned Promise before invoking the second operation.
- P1: bound cookie-request processing with positive-safe-integer defaults of 32
  header values, 16 KiB total header characters, and 64 cookie pairs. Reject
  over-limit input as `"request-too-large"`, stop on a second target cookie,
  and avoid repeated accumulator copies. Test oversized and mass-duplicate
  input.
- P1/P2: validate every injected clock result as a finite safe-integer
  millisecond value and every computed expiry as a valid Protobuf Timestamp
  instant. Invalid/throwing clocks fail closed, clear retained sessions, and
  return `undefined` or a `"clock-failure"` creation/rotation rejection.
  Throwing/wrong-length randomness consumes bounded attempts and maps to
  `"entropy-exhausted"` rather than escaping the result contract.
- P2: normalize negative millisecond timestamps so nanos are non-negative, and
  add a pre-epoch regression.
- P2: document every public option member: units, defaults, exact callback
  requirements, secret copying/minimum, canonical origins, cookie names, and
  parsing bounds.
- P2: correct the README's stale blanket deferral of concrete session
  strategies and document expired resolve/rotate plus capacity outcomes.
- P2: correct the implementation report to the generated 64-export inventory.

All four concerns reopen because the contract, bounded parsing, lifecycle,
tests, TSDoc, and README change. One implementation owner receives this single
batch before targeted re-review.

### C1 correction verification and re-review assignments

- The implementation owner and replacement lifecycle-test owner ran under
  explicit `gpt-5.6-terra` / `medium`. Runtime self-introspection was
  unavailable; no visible mismatch or fallback occurred.
- Independent coordinator verification passed 6 auth files / 114 tests, auth
  typecheck, generated TypeDoc/API inventory, Prettier, cleanup rules, and diff
  hygiene. The subordinate cleanup warning was an invocation-context artifact;
  the canonical cleanup command is green.
- Style/maintainability reopens under the existing reviewer with explicit
  `gpt-5.6-terra` / `high`, limited to unrelated `=` cookies, forced lifecycle
  tests, module shape, and direct correction effects.
- TypeScript/API docs reopens under the existing reviewer with explicit
  `gpt-5.6-terra` / `high`, limited to clock/entropy result contracts,
  Timestamp normalization, bounded parser options/rejection, TSDoc, inventory,
  and report evidence.
- Performance/reliability reopens under the existing reviewer with explicit
  `gpt-5.6-terra` / `high`, limited to callback reentrancy, synchronous
  call-order, post-callback expiry, entropy zeroing, finite parsing, invalid
  clock behavior, and retention.
- Documentation reopens under immutable `gpt-5.6-luna` / `medium`, limited to
  corrected session-strategy availability, expiry/capacity behavior, options,
  limitations, and report evidence. Desktop cannot accept a redundant fixed
  role override.
- All reviewers are read-only with no edits, commits, pushes, merges, children,
  C2+, or Spine JVM project execution. Explicit dispatch and immutable profile
  are the metadata evidence.

### C1 targeted re-review results

All four concerns ran under their recorded explicit or immutable profiles.
Runtime self-introspection remained unavailable; no visible mismatch or
fallback occurred.

- Style/maintainability: clean.
- TypeScript/API docs: no P0/P1 contract defect; accepted P2 option/README/report
  documentation corrections.
- Performance/reliability: accepted one P1 finite-processing defect and two P2
  direct-effect test gaps.
- Documentation: accepted the same deterministic P2 batch.

Accepted final correction batch:

- P1: replace `Object.keys()` materialization with own-property incremental
  enumeration, charge/count each supplied header field before inspecting its
  value (including `undefined`), and stop at the existing finite limits.
- P2: retain a 31-byte random buffer and prove it is zeroed after the bounded
  entropy rejection.
- P2: advance the clock inside random callbacks and prove post-callback create
  cleanup/capacity behavior plus rotation expiry rejection/removal.
- P2: complete public TSDoc for CSRF-secret copy/minimum/close-zeroing, canonical
  non-empty exact Origins, distinct valid default/custom `__Host-` names,
  clock units/fail-closed behavior, exact `randomBytes(32)` calls,
  returned-buffer zeroing, and bounded entropy mapping.
- P2: narrow the README deferral to signed/OIDC/provider/reconnect work,
  document configurable option names/units/defaults/callback requirements and
  cookie-name constraints, and call three the default collision-attempt bound.
- P2: make the 109-test checkpoint explicitly historical, record 114 as current,
  and remove the stale contradictory cleanup-failure claim because independent
  canonical cleanup enforcement passes.

Reliability reopens for the field-bound behavior and direct-effect tests.
TypeScript/API docs and documentation reopen for their deterministic text;
style remains clean unless the implementation shape changes substantively.

### C1 final acceptance re-review assignments

- Independent coordinator verification passed 6 auth files / 116 tests, auth
  typecheck, generated TypeDoc/API inventory, Prettier, diff hygiene, and an
  explicit 120-column scan over all untracked C1 files.
- Performance/reliability reopens under the existing reviewer with explicit
  `gpt-5.6-terra` / `high`, limited to incremental own-field bounds,
  wrong-length entropy zeroing, and create/rotate clock-advance regressions.
- TypeScript/API docs reopens under the existing reviewer with explicit
  `gpt-5.6-terra` / `high`, limited to final option/callback TSDoc,
  result/inventory agreement, and report evidence.
- Documentation reopens under immutable `gpt-5.6-luna` / `medium`, limited to
  README availability/options/defaults/boundaries and staged report evidence.
  Desktop cannot accept a redundant fixed-role override.
- Style remains clean because the final changes preserve the reviewed module
  shape; deterministic line wrapping is independently verified.
- All reviews are read-only with no edits, commits, pushes, merges, children,
  C2+, or Spine JVM project execution. Explicit dispatch and immutable profile
  are the metadata evidence.

### C1 lifecycle correction evidence

- The explicitly assigned existing `implementer` (`gpt-5.6-terra` / `medium`)
  added the two missing close-re-entrancy cases and all four non-awaited
  call-order regressions. Independent model self-introspection is unavailable;
  explicit dispatch and immutable configured role/profile show no visible
  mismatch or inherited fallback.
- No production defect was exposed: focused opaque-session tests passed 17
  tests and the full auth suite passed 6 files / 114 tests. The regressions
  prove terminal `closed` results after create/close and rotate/close callbacks;
  then prove rotate/rotate first-winner/new-credential liveness, logout/rotate
  `not-found`, and resolve snapshots before later rotation/logout.
- Auth typecheck, generated API/docs checking, Prettier, and diff hygiene
  passed. The final repository-wide cleanup command reports unrelated existing
  subscription/native/client findings; the owned lifecycle test has no local
  cleanup violation. The remaining targeted re-review may inspect these tests
  and the already-existing lifecycle guards; no source correction is pending
  from this slice.

### C1 final targeted correction implementation evidence

- The existing `implementer` completed the accepted final C1 batch under the
  explicitly assigned `gpt-5.6-terra` / `medium` profile. Runtime model
  self-introspection is unavailable on this surface; the explicit dispatch and
  immutable configured profile are the available metadata, with no visible
  mismatch or inherited-profile fallback.
- RED reproduced the finite-processing defect: after an `undefined` own field
  exhausted `maxHeaderValues`, parsing still read a later accessor value.
  GREEN uses own-property incremental enumeration, charges/counts each field
  before value inspection, and stops at the existing bounds.
- Direct-effect regressions retain and inspect a zeroed 31-byte buffer, and
  advance the injected clock inside randomness to prove post-callback create
  capacity/expiry cleanup: a nested credential expires at a one-session limit,
  then only the outer session remains live. The rotation case still proves
  expiry rejection/removal. README, exact public TSDoc, and
  historical-versus-current evidence are corrected in the same batch.
  Validation passes: focused opaque sessions 1 file / 19 tests; full
  auth 6 files / 116 tests; auth typecheck; generated TypeDoc/API checking;
  Prettier; canonical cleanup enforcement; and `git diff --check`.

### B4 full-gate coverage correction implementation evidence

- The existing `implementer` completed the bounded test-only correction under
  explicit `gpt-5.6-terra` / `medium` assignment. Runtime self-introspection
  is unavailable; explicit dispatch and immutable configured profile are the
  available metadata, with no visible mismatch or inherited fallback.
- The added behavior tests cover direct relay admission to a waiting consumer,
  backend update rejection after graceful closure, and the public `Internal`
  failure for an unexpected Activate acknowledgement. Production behavior and
  all coverage policy remain unchanged.
- Focused direct Vitest validation passed 2 files / 38 tests; the focused auth
  suite passed 5 files / 97 tests. Focused V8 coverage covered the targeted
  native branches, but its global threshold fails by design with 84/9,729
  covered branches because only two files ran. The canonical full coverage gate
  remains the required acceptance evidence. Prettier for the added relay test
  and durable records plus `git diff --check` pass; standalone ESLint reports
  existing errors elsewhere in the already-untracked B4 test files.
- `pnpm exec vitest` could not start due to a changed installed-workspace
  `linkWorkspacePackages` setting. No dependency install was run; the installed
  Vitest binary was used for focused validation. No commit, push, merge, C+,
  child dispatch, or Spine JVM project command ran.

### C1 final acceptance dispositions and affected-lane recheck

- Performance/reliability accepted the final implementation as clean under its
  explicitly assigned `gpt-5.6-terra` / `high` profile. Incremental field
  charging, wrong-length entropy zeroing, nested expiry/capacity behavior, and
  rotation expiry/removal all passed.
- Documentation accepted availability, configuration, callback, cookie,
  deferral, and staged 109/114/116 evidence under the immutable
  `documentation_reviewer` `gpt-5.6-luna` / `medium` profile. Desktop cannot
  accept a redundant override; runtime self-introspection is unavailable, with
  no visible mismatch or fallback.
- TypeScript/API docs accepted behavior and found two bounded corrections under
  its explicitly assigned `gpt-5.6-terra` / `high` profile:
  successful opaque-session create/rotate results must expose a cookie-only
  credential type, and the report must record the unrelated canonical cleanup
  baseline honestly.
- The correction exports `CookieCredential`, narrows both success unions,
  updates the generated API inventory to 65 auth exports, and records the
  cleanup baseline limitation plus the passing explicit C1-owned line scan.
  Verification passed 6 auth files / 116 tests, auth typecheck, generated
  TypeDoc/API checking, and diff hygiene.
- TypeScript/API docs reopens only for the narrowed result contract and API
  inventory under explicit `gpt-5.6-terra` / `high`. Documentation reopens
  only for the corrected cleanup-evidence sentence under immutable
  `gpt-5.6-luna` / `medium`. Both are read-only; runtime self-introspection is
  unavailable, while dispatch/profile metadata shows no visible mismatch.

Final affected-lane results:

- TypeScript/API docs: clean. `CookieCredential`, both success-union
  narrowings, the 65-name inventory, and type-only/runtime export behavior
  agree.
- Documentation: clean after removing one later contradictory cleanup
  sentence. The report now consistently distinguishes the passing C1-owned
  scan from unrelated canonical cleanup baseline findings.
- Both reviewers retained their recorded profiles. Runtime self-introspection
  remained unavailable, with no visible mismatch or fallback. C1 has no open
  review finding.
- Final canonical verification passed 147 runnable test files / 2,750 tests
  with 90.04% branch coverage (8,977/9,970). No Spine JVM command ran. C1 is
  accepted for commit.

## C2 signed-session architecture assignment

- C1 is committed and remotely synchronized at `c765409f`.
- C2 is high-risk because it freezes a public self-contained token contract,
  ES256 verification and issuance, bounded key selection/rotation, temporal and
  audience validation, revocation semantics, and secret-retention behavior.
- The existing `requirements_splitter` is assigned read-only with explicit
  `gpt-5.6-sol` / `high`. It must return the smallest non-overengineered C2
  contract and behavior-first slices without editing, Git mutation, children,
  C3+, or any Spine JVM project command.
- The execution surface supports explicit child model/reasoning dispatch.
  Runtime self-introspection may be unavailable; the explicit dispatch and
  immutable configured role/profile are the acceptance metadata unless a
  visible mismatch or fallback occurs.
- The planner supplied a useful checkpoint and reported no blocker, but did not
  finish the exact public unions/defaults inside the bounded planning window.
  It was interrupted rather than falsely recorded complete. Its checkpoint
  froze one Node-only `SignedSessions`, bearer-only compact ES256, mandatory
  bounded claims, P-256 keys, a bounded active/retired ring, optional explicit
  revocation, and no C3/C5 scope. Runtime self-introspection was unavailable;
  the explicit Sol/high dispatch showed no visible mismatch.
- The coordinator froze the remaining finite defaults and exact behavior in
  `C2_TASK_BRIEF.md`, preserving the checkpoint and existing Wave 4 decisions
  without adding a JOSE dependency or speculative abstraction.

### C2 implementation assignment

- One existing `implementer` owns C2 source/tests, auth exports/README,
  generated API inventory, and C2 implementation evidence under explicit
  `gpt-5.6-terra` / `medium`.
- It must execute the frozen behavior-first order, make no Git mutation, spawn
  no children, preserve the local progress ledger, remain inside C2, and run no
  Spine JVM project command. Runtime self-introspection may be unavailable;
  explicit dispatch and immutable role/profile are the acceptance metadata.

## C2 implementation evidence awaiting review

- The existing implementer was explicitly dispatched as `gpt-5.6-terra` /
  `medium`; self-introspection is unavailable and no profile mismatch was
  visible. The bounded C2 owner added local Node ES256 signed sessions only.
- Its behavior-first evidence is RED 4/4 (missing constructor) followed by
  GREEN focused sessions 23/23 and auth typecheck. Specialist review remains
  pending; the dedicated security gate remains reserved for final Wave 4.
- The checkpoint is not accepted for review: the owner itself reported the
  broader frozen matrix, finite initial retired-key deadlines, safe retention
  arithmetic, and code-quality refactor remain. The same existing implementer
  is reassigned the single completion batch under its explicit
  `gpt-5.6-terra` / `medium` profile so it retains implementation context.

### C2 coordinator completion and mechanical gate

- The same implementation owner returned multiple truthful partial checkpoints
  but could not complete the finite table matrix inside its execution windows.
  This repeated limitation was not a technical blocker. After the writer was
  complete, the coordinator became sole writer for the remaining tests/fixes;
  there was no overlapping file ownership.
- RED exposed array-valued attributes being accepted as an empty map and
  terminal close losing to a late revocation failure. Both are corrected.
- Coordinator inspection also bounded retired-key admission before imports,
  made attribute enumeration incremental, required the exact 16-byte `jti`
  encoding, released the active private-key reference on close, swept retired
  keys during logout, and removed an unnecessary public signer hook.
- Mechanical verification passed the 17-test signed suite, full auth 7 files /
  133 tests, auth typecheck, generated TypeDoc/API inventory with 76 auth
  exports, targeted Prettier, explicit C2 line bounds, and diff hygiene.
- C2 is ready for one complete relevant specialist review wave. No Spine JVM
  project command ran; final Wave 4 security remains reserved.

### C2 specialist review assignments

- Style/maintainability: existing reviewer, explicit
  `gpt-5.6-terra` / `high`, limited to C2 module depth, readability, naming,
  duplication, and avoidance of speculative auth/JOSE abstractions.
- TypeScript/API docs: existing reviewer, explicit
  `gpt-5.6-terra` / `high`, limited to public signed-session declarations,
  Node `KeyObject` exposure, result unions, `SessionResolver` compatibility,
  TSDoc, and the 76-export inventory.
- Performance/reliability: existing reviewer, explicit
  `gpt-5.6-terra` / `high`, limited to finite parsing/key/attribute bounds,
  key retention/rotation atomicity, callback races, revocation fail-closed
  behavior, secret/reference lifecycle, and test completeness.
- Documentation: immutable existing `documentation_reviewer`
  `gpt-5.6-luna` / `medium`, limited to availability, configuration/defaults,
  bearer/claims/key lifecycle, revocation trade-offs, extension seam,
  limitations, and evidence. Desktop cannot accept a redundant override.
- All lanes are read-only, childless, Git-read-only, C2-only, and prohibited
  from any Spine JVM project execution. Runtime self-introspection may be
  unavailable; explicit dispatch or immutable role/profile and absence of a
  visible mismatch are the acceptance metadata.
- Security is N/A for this slice as a standalone lane because the protocol
  reserves the dedicated security reviewer for the final complete Wave 4
  release boundary; C2 findings are retained for that gate.

### C2 specialist review results and correction batch

All lanes used the recorded explicit or immutable profiles. Runtime
self-introspection was unavailable, with no visible mismatch or fallback.

- Style/maintainability: two P2 findings—deduplicate resolve/logout token
  verification and replace an inert conditional rejection type.
- TypeScript/API docs: two P2 findings—complete member/option TSDoc and add the
  frozen README decision table.
- Performance/reliability: one P1 finding—close must win when random/clock
  callbacks close and then throw or return invalid, while ordinary callback
  failures keep their specific reason.
- Documentation: one P1 stale signed-session deferral and P2 omissions for
  `retiredKeys` plus the revocation callback contract.

The single correction batch:

- extracts one private verified-claims path shared by resolve/logout and uses a
  plain internal issue-rejection alias;
- distinguishes callback-induced terminal close from ordinary clock/entropy
  failure and adds close-then-throw/invalid regressions for issue/rotate;
- completes public member/default/unit/ownership TSDoc;
- corrects signed-session availability, documents `retiredKeys` and revocation
  callbacks, and adds an opaque-versus-signed decision table.

Targeted correction verification passed 17 signed tests, auth typecheck,
generated TypeDoc/API inventory at 76 auth exports, Prettier, and diff hygiene.
All four affected concerns reopen read-only under their original recorded
profiles; no Spine JVM project command may run.

### C2 targeted re-review closure

- Style/maintainability: clean.
- Performance/reliability: clean; callback-induced close is distinct from
  ordinary clock/entropy failure and shared verification preserves fail-closed
  resolution/logout behavior.
- TypeScript/API docs: clean; public TSDoc and the curated 76-export surface
  agree.
- Documentation: clean after compacting the decision table, assigning browser
  CSRF to `OpaqueSessionCookies`, and making shared revocation conditional on
  enabling revocation.
- All reviewers retained their recorded profiles. Runtime self-introspection
  remained unavailable, with no visible mismatch or fallback. C2 has no open
  review finding and proceeds to the canonical full gate.
- Final canonical verification passed 148 runnable test files / 2,767 tests
  with 90.06% branch coverage (9,206/10,221). No Spine JVM command ran. C2 is
  accepted for commit.

## C3 generic OIDC architecture assignment

- C2 is committed and remotely synchronized at `4a570520`.
- C3 is high-risk because it freezes public external-identity, atomic
  state/nonce/PKCE transaction, redirect, provider-token validation, identity
  mapping, one-time exchange-grant, and secret lifecycle contracts.
- Primary standards grounding is RFC 9700, RFC 7636, and OpenID Connect Core:
  exact pre-registered redirects, authorization code only, transaction-specific
  state/nonce/PKCE, S256 only, single consumption, issuer validation, and no
  bearer credential in redirect URLs.
- The existing `requirements_splitter` is assigned read-only with explicit
  `gpt-5.6-sol` / `high`. It must return the smallest non-overengineered C3
  contract/slices without edits, Git mutation, children, C4+, or any Spine JVM
  project command. Runtime self-introspection may be unavailable; explicit
  dispatch and immutable role/profile are the acceptance metadata.
- The planner did not return a checkpoint or final within the bounded planning
  window and was interrupted. No result or blocker is claimed. The coordinator
  froze the minimal standards-grounded contract in `C3_TASK_BRIEF.md`, keeping
  provider networking/JWKS in C4 adapters and HTTP/browser integration out of
  C3.

### C3 implementation assignment

- The existing `implementer` is the sole C3 production-code owner, explicitly
  dispatched as `gpt-5.6-terra` / `medium`.
- Its bounded first slice is C3 behavior-first slice 1 in
  `C3_TASK_BRIEF.md`: finite construction and `start()` transaction behavior,
  its focused tests, and an append-only implementation report. It owns only
  the new OIDC source/test paths and the C3 report during this slice.
- The implementer must use RED/GREEN TDD, may not mutate Git, spawn children,
  start C4+, or execute any Spine JVM project command. Subsequent C3 slices
  return to the same implementation context.
- Runtime self-introspection may be unavailable. Acceptance requires the
  explicit dispatch fields, the configured existing role/profile, and no
  visible mismatch or fallback.
- Slice 1 returned from the configured existing `implementer`. Runtime
  self-introspection was unavailable; the explicit `gpt-5.6-terra` /
  `medium` dispatch fields and immutable role profile show no mismatch or
  fallback. Focused tests and auth typecheck passed independently; the
  coordinator found formatting drift in the new brief/report and returned
  that deterministic correction to the same owner before Slice 2.
- Slice 2 returned from the same configured role/profile with runtime
  self-introspection still unavailable and no visible mismatch. The owner
  disclosed one accidental read-only `git diff --check`; it made no repository
  change and does not invalidate the result. Independent verification passed
  9/9 focused tests, auth typecheck, changed-file Prettier, and diff hygiene.
  Slice 3 returns to the same implementation context.
- Slice 3 completed browser-PKCE grant exchange, burn-before-check replay
  safety, session issuance, expiry/failure behavior, and terminal close races.
  Independent verification passed 12/12 focused tests, auth typecheck,
  changed-file Prettier, and diff hygiene. Runtime self-introspection remains
  unavailable with no visible mismatch. The same owner now completes the
  public surface, documentation, and a shallow maintainability split before
  specialist review.

### C3 mechanical gate and specialist assignments

- C3 is complete as a shallow contracts/runtime pair with package-root exports
  and generic OIDC documentation. The implementation owner used the recorded
  explicit `gpt-5.6-terra` / `medium` profile; runtime self-introspection was
  unavailable with no visible mismatch or fallback.
- The owner's first full-auth run observed one unrelated signed-session
  assertion flake; its immediate confirmation and the coordinator rerun both
  passed. The coordinator gate passes 8 auth files / 145 tests, auth
  typecheck, generated TypeDoc/API checking at 93 auth exports, changed-file
  Prettier, and diff hygiene.
- Style/maintainability: existing reviewer, explicit
  `gpt-5.6-terra` / `high`, limited to C3 module cohesion, naming, duplication,
  method size, test quality, and avoiding speculative OIDC/HTTP/provider
  abstractions.
- TypeScript/API docs: existing reviewer, explicit
  `gpt-5.6-terra` / `high`, limited to the 17 new root exports, result unions,
  provider/mapping/session seams, runtime/type agreement, TSDoc, and the
  93-export inventory.
- Performance/reliability: existing reviewer, explicit
  `gpt-5.6-terra` / `high`, limited to finite admission/storage, atomic
  state/grant consumption, deadlines/abort/close races, collision/expiry,
  defensive copying/zeroing, and behavior-test completeness.
- Documentation: immutable existing `documentation_reviewer`
  `gpt-5.6-luna` / `medium`, limited to the generic flow, exact defaults,
  extension ownership, POST/`no-store`, provider-token handling, limitations,
  and compile-valid examples. Desktop cannot accept a redundant override.
- All lanes are read-only, childless, Git-read-only, C3-only, and prohibited
  from any Spine JVM project execution. Runtime self-introspection may be
  unavailable; explicit dispatch or immutable role/profile and absence of a
  visible mismatch are the acceptance metadata. Dedicated security remains
  the final complete Wave 4 gate.

### C3 specialist review results

- Style/maintainability ran under the explicitly dispatched existing
  `gpt-5.6-terra` / `high` role. Runtime self-introspection was unavailable,
  with no visible mismatch or fallback. It found one P1 fail-closed defect:
  malformed `sessionIssuer` session data can throw, plus P2 stale class TSDoc
  and missing cross-transaction nonce/provider-verifier uniqueness coverage.
  Spec and quality are not approved pending the aggregated correction batch.
- TypeScript/API docs ran under the explicitly dispatched existing
  `gpt-5.6-terra` / `high` role. Runtime self-introspection was unavailable,
  with no visible mismatch or fallback. It confirmed the malformed-session and
  stale-TSDoc findings and additionally found that the 93-export inventory was
  not frozen, provider-token-like claim names can enter retained identity data,
  callback input does not type exactly-one code/error, and negative Timestamp
  nanos are accepted. Spec and quality are not approved pending the same
  aggregated correction batch.
- Performance/reliability ran under the explicitly dispatched existing
  `gpt-5.6-terra` / `high` role. Runtime self-introspection was unavailable,
  with no visible mismatch or fallback. It confirmed malformed-session and
  Timestamp findings, found that re-entrant clock/random callbacks can make
  terminal close lose to lesser rejection reasons, and requested direct
  grant-capacity reclamation, collision exhaustion, mapping/session deadline,
  and close-race coverage.
- Documentation ran under the existing immutable
  `documentation_reviewer` `gpt-5.6-luna` / `medium` profile. The Desktop
  surface rejected a redundant explicit Luna override, so the immutable role
  configuration is the runtime metadata; no mismatch or fallback was visible.
  It found that the documented redirect plus browser exchange lacks a safe
  grant-handoff mechanism and that exact input/claim bounds are omitted.
- The single correction batch therefore covers: structural malformed-session
  rejection; close precedence for re-entrant clock/random callbacks; claim-name
  rejection for token material; canonical Timestamp nanos; callback XOR types;
  frozen 93-export inventory; current class TSDoc; transaction uniqueness and
  finite grant/deadline/race tests; and actionable grant handoff plus exact
  bounds documentation. All affected concerns reopen once after focused
  correction evidence.
- The owner completed the runtime, public-contract, inventory, TSDoc, and README
  corrections with 14/14 focused and 147/147 full-auth tests, typecheck,
  generated docs/API checking, and Prettier, but explicitly did not add the
  requested cross-transaction uniqueness, grant-capacity reclamation/collision,
  mapping/session deadline, and re-entrant-close matrix. This is an incomplete
  checkpoint, not an accepted correction or re-review boundary. The same
  Terra/medium owner receives the exact remaining test-first batch.
- The next checkpoint adds cross-transaction state/nonce/provider-challenge
  uniqueness and mapping/session deadline settlement, passing 17/17 focused and
  150/150 full-auth tests plus typecheck, docs/API, and formatting. It remains
  incomplete because direct grant capacity/collision and the close-reentrancy
  table are absent. Those two concerns are split into smaller sequential
  completions in the same implementation context.
- The grant-lifecycle completion adds direct expiry/capacity reclamation and
  finite grant-ID collision exhaustion, including preservation of the
  original one-use grant. Focused OIDC passes 19/19 with auth typecheck and
  formatting. Only the close-reentrancy matrix remains before correction
  acceptance.
- The final close-reentrancy matrix completes at 23/23 focused OIDC tests and
  156/156 owner-run full-auth tests, with typecheck, docs/API, and formatting
  green. Coordinator verification then reproduced the pre-existing signed
  session tamper failure at 155/156. Root-cause evidence proves Node accepts a
  non-canonical final base64url character with changed unused padding bits as
  the same 64 signature bytes. This creates signature-string malleability and
  is a real deterministic verification concern, not a C3 regression.
- Before C3 re-review, the same existing `implementer` is assigned a bounded
  regression fix under explicit `gpt-5.6-terra` / `medium`: make the signed
  signature mutation deterministic, reject non-canonical signature encoding,
  and rerun signed/auth/C3 gates. It may touch only the signed source/test and
  append-only C3 evidence/logs, with no Git, children, C4+, or JVM execution.
- RED proved the non-canonical signature text was accepted; GREEN requires the
  decoded 64-byte signature to round-trip to the exact encoded segment.
  Independent correction verification passes signed plus OIDC 41/41, full auth
  157/157, auth typecheck, generated TypeDoc/API checking at 93 auth exports,
  Prettier, and diff hygiene.
- The complete corrected package reopens style, TypeScript/API,
  performance/reliability, and documentation once under their original
  recorded profiles. Review scope is limited to the prior findings and
  correction side effects; the final Wave 4 security gate remains deferred.
- Targeted style re-review used the original explicit Terra/high profile;
  runtime self-introspection was unavailable with no visible mismatch. It
  closes malformed-session, TSDoc, deadline/capacity/close, and signed
  canonicality findings, but finds two P2 residuals: runtime/test coverage
  proves only state uniqueness, not transaction-specific nonce/provider
  verifier uniqueness, and the collision test cannot prove the original grant
  survives because its verifier/session path cannot succeed.
- Targeted TypeScript/API re-review used the original explicit Terra/high
  profile; runtime self-introspection was unavailable with no visible
  mismatch. It approves the inventory, XOR type, Timestamp, TSDoc, session
  object, and signed-canonicality corrections but finds one P1 residual:
  null/array/non-record or throwing `ExternalIdentity.claims` can escape or be
  normalized instead of returning the callback rejection union.
- Targeted performance/reliability re-review used the original explicit
  Terra/high profile; runtime self-introspection was unavailable with no
  visible mismatch. It approves close precedence, finite stores/collisions,
  deadlines, Timestamp, cleanup, and signed canonicality, but finds one P1
  residual: throwing getters/Proxies in adapter-issued session data can escape
  after the bounded callback, and it independently confirms that grant
  collision survival is not behaviorally proven.
- Targeted documentation re-review ran under the immutable Luna/medium role;
  no visible mismatch or fallback was exposed. It is clean: safe grant handoff,
  exact bounds, provider-token exclusions, adapter ownership, POST/`no-store`,
  limitations, and snippets now agree with C3.
- The final C3 correction batch is therefore limited to guarded plain-record
  external claims; one guarded snapshot of hostile session-issuer output;
  active-transaction nonce/provider-verifier uniqueness; and a collision test
  that proves the pre-existing grant succeeds once before replay rejection.
  Only style, API, and reliability reopen after focused evidence;
  documentation remains clean.
- The owner implemented guarded claim/session snapshots and active transaction
  uniqueness but returned before verification after correcting a TypeScript
  snapshot-typing seam. This is an incomplete checkpoint, not a blocker or
  accepted correction. The same Terra/medium context must finish the hostile
  object, uniqueness, collision-preservation, and full gate evidence.
- The completed final batch safely rejects hostile claim/session objects,
  finitely enforces active nonce/provider-verifier uniqueness, and proves the
  original collision-surviving grant issues exactly once with a real S256
  proof. Independent verification passes signed plus OIDC 44/44, full auth
  160/160, auth typecheck, generated TypeDoc/API checking at 93 exports,
  Prettier, and diff hygiene. Only style, API, and reliability reopen for a
  final targeted verdict; documentation remains clean.
- Final TypeScript/API re-review uses the original explicit Terra/high profile;
  runtime self-introspection is unavailable with no visible mismatch. It
  approves every prior API concern but finds one last P1 hostile-adapter seam:
  mapping output is validated and copied through separate unguarded getter/
  Proxy reads, allowing callback rejection escape or changed data. One guarded
  mapping snapshot must be both validated and retained as `mapping-failed`.
- Final style re-review uses the original explicit Terra/high profile; runtime
  self-introspection is unavailable with no visible mismatch. It independently
  confirms the mapping-output P1 and adds one P2 test residual: the material
  retry case combines nonce and verifier reuse, so it does not independently
  prove verifier-only collision detection. Grant survival, claim/session
  guards, and signature canonicality are approved.
- Final reliability re-review uses the original explicit Terra/high profile;
  runtime self-introspection is unavailable with no visible mismatch. It
  independently confirms both remaining items and approves every other
  lifecycle, capacity, deadline, cleanup, and signed-canonicality path.
- The last micro-batch is exactly one guarded single mapping snapshot plus
  separate nonce-only and verifier-only active-collision tests. No other
  concern or documentation reopens.
- The micro-batch captures mapping output once under guarded code and adds
  independent nonce-only/verifier-only collision tests. Independent
  verification passes signed plus OIDC 47/47, full auth 163/163, auth
  typecheck, generated TypeDoc/API checking at 93 exports, Prettier, and diff
  hygiene. Style, API, and reliability perform one residual-only closure
  check; documentation remains clean.
- Residual-only style and API checks use their original explicit Terra/high
  profiles with unavailable self-introspection and no visible mismatch. Both
  find the mapping "snapshot" still validates getter-backed nested objects and
  then rereads them for retention, allowing changing getters to alter accepted
  data. Style also finds the nonce-only/verifier-only tests assert only
  `started`, so they do not prove a retry produced different nonce/challenge
  output. Spec/quality remain unapproved pending the reliability closure result
  and one exact correction.
- Residual-only reliability uses the original explicit Terra/high profile with
  unavailable self-introspection and no visible mismatch. It confirms exactly
  the same P1/P2 and no additional finding. The correction must read every
  nested mapping field into locals once, validate/copy only those locals, add
  changing/late-throw getter regressions, and assert changed URL nonce or
  provider challenge after the corresponding isolated collision.
- The owner corrects the single-read mapping snapshot and adds a changing-getter
  regression. Independent gates pass signed plus OIDC 48/48, full auth
  164/164, typecheck, generated docs/API, Prettier, and diff hygiene. However,
  direct inspection confirms the nonce-only/verifier-only parameterized test
  still asserts only two successful starts and does not compare the relevant
  URL parameter. The correction is not accepted until those exact assertions
  are present.
- The test-only closure now compares the successful retry URL: nonce differs
  for nonce-only reuse and provider S256 challenge differs for verifier-only
  reuse. Independent focused verification passes OIDC 30/30, auth typecheck,
  Prettier, and diff hygiene. The prior full-auth 164/164 gate remains current
  because no runtime changed after it. Style/API/reliability perform only the
  residual closure check.
- Residual-only closure is clean in style, TypeScript/API, and
  performance/reliability. Each used its original explicit Terra/high profile;
  runtime self-introspection was unavailable with no visible mismatch or
  fallback. The reviewers confirm the single-read frozen mapping snapshot and
  meaningful isolated nonce/verifier retry assertions. Documentation remains
  clean under its immutable Luna/medium profile.
- All four canonical C3 concerns have clean dispositions. The final Wave 4
  security reviewer remains correctly deferred. C3 proceeds to the canonical
  full generated-coverage gate; no Spine JVM command has run.
- The first canonical gate attempt was invalidated by sandbox `EPERM` on
  loopback listeners, ZeroMQ IPC sockets, and child processes. The identical
  permission-enabled run executes correctly and passes 149 runnable files /
  2,798 tests, but global branch coverage is 89.62% (9,509/10,610), below the
  required 90%; OIDC is 77.77% (301/387 branches).
- C3 therefore remains unaccepted. The existing `implementer` is assigned one
  behavior-focused coverage completion under explicit `gpt-5.6-terra` /
  `medium`, using the generated OIDC LCOV misses. It may add only meaningful
  input-boundary, fail-closed, expiry/capacity, and lifecycle tests (runtime
  changes only for a demonstrated defect) until the global canonical threshold
  is restored. No Git, children, C4+, or JVM execution is allowed.
- The first coverage checkpoint adds 15 constructor-validation cases, passes
  45 focused tests, and raises OIDC branches only from 77.77% to 79.58%.
  It is incomplete. The remaining work is split into callback/provider/mapping
  rejection behavior, then exchange/lifecycle behavior, in the same
  Terra/medium context.
- Repeated bounded owner resumptions advance meaningful tests to 61 and remove
  dead helpers, but return partial matrices without the required BRH/BRF
  measurement. With that writer complete and no overlapping ownership, the
  coordinator becomes sole owner of the remaining test-only coverage matrix.
  This is not a blocker or a new role; it avoids another context rebuild and
  will stop immediately once the permission-enabled canonical threshold passes.
- Coordinator-owned RED exposed array-valued session attributes being spread
  into an empty object and accepted. GREEN requires a plain record before the
  single defensive copy. The coordinator also completes behavior matrices for
  mapping/session bounds and removes three proven-dead identity helpers.
- Focused OIDC passes 87/87 at 90.05% branches (317/352), full auth passes
  8 files / 221 tests, auth typecheck, generated TypeDoc/API checking at 93
  exports, Prettier, and diff hygiene pass.
- Style, TypeScript/API, and performance/reliability reopen narrowly under
  their original explicit Terra/high profiles for dead-code cleanup,
  fail-closed provider/session snapshots, clock-result simplification, and
  behavior-test quality. Documentation is N/A because no documentation changed
  after its clean closure and all public claims remain unchanged.
- Narrow style review is clean under its original explicit Terra/high profile;
  runtime self-introspection is unavailable with no visible mismatch. It
  approves the cleanup, snapshots, clock simplification, and behavior-focused
  tests.
- Narrow TypeScript/API review uses its original explicit Terra/high profile;
  runtime self-introspection is unavailable with no visible mismatch. It finds
  one P1 regression from dead-helper removal: mapping now preserves issuer and
  subject but may replace or omit provider-verified claims. Exact normalized
  claim equality must be restored without rereading hostile mapping data.
- Narrow reliability review uses its original explicit Terra/high profile;
  runtime self-introspection is unavailable with no visible mismatch. It
  independently confirms the same P1 and approves all other slice behavior.
- The correction compares the guarded mapped-claims snapshot to the frozen
  provider snapshot, rejects dropped/altered claims, and retains the provider
  snapshot. OIDC passes 89/89 at 90.22% branches (323/358), full auth 223/223,
  typecheck, Prettier, and diff hygiene. Only API and reliability reopen.
- The API and reliability residual recheck uses the original explicit
  `gpt-5.6-terra` / `high` profiles. Runtime self-introspection remains
  unavailable with no visible mismatch. Both concerns find one exact P1:
  assigning an own enumerable `__proto__` provider claim into `{}` changes the
  target prototype instead of preserving the claim, so the provider-to-mapping
  snapshot is not lossless for a valid hostile key.
- The correction defines copied keys as own enumerable data properties and adds
  a provider-to-mapping-to-grant regression for an own `__proto__` claim.
  Focused OIDC passes 90/90 at 90.50% branches (324/358); full auth passes
  224/224. TypeScript, generated TypeDoc/API inventory at 93 auth exports,
  C3-scoped Prettier, and diff hygiene pass. Two formatter warnings in gateway
  tests are confirmed in the committed C2 baseline and are not C3 changes.
  Only API and reliability reopen for this correction.
- The residual TypeScript/API and performance/reliability rechecks are clean.
  Both use the existing explicit `gpt-5.6-terra` / `high` profiles; runtime
  self-introspection is unavailable with no visible mismatch. They confirm
  that `__proto__` is an own enumerable data property without prototype
  mutation, remains bounded and frozen, and is retained through mapping and
  one-time grant issuance. No API, TypeDoc, lifecycle, or fail-closed concern
  reopens. All C3 specialist concerns are closed; final Wave 4 security remains
  deferred to the Wave boundary.
- The permission-enabled canonical gate first reports one timing-dependent
  delivery-server signal-test failure outside C3 after 2,857 passing tests.
  The unchanged focused lifecycle suite passes 4/4, and one identical canonical
  rerun passes 149 files / 2,858 tests with 3 files / 25 tests skipped and
  90.08% branches (9,532/10,581). C3 is accepted for commit. No Spine JVM
  command ran.

## C4 provider adapter review

- C4 is high-risk. One complete review wave covers the existing
  style/maintainability, TypeScript/API, documentation, and
  performance/reliability concerns.
- Style/maintainability expected profile: existing role,
  `gpt-5.6-terra` / `high`.
- TypeScript/API expected profile: existing role, `gpt-5.6-terra` / `high`.
- Performance/reliability expected profile: existing role,
  `gpt-5.6-terra` / `high`.
- Documentation expected profile: existing role, immutable
  `gpt-5.6-luna` / `medium`.
- Each dispatch explicitly supplies its role/profile. Actual runtime metadata
  will be recorded before accepting results; unavailable self-introspection
  will be recorded honestly. Final Wave 4 security review remains deferred.
- Style/maintainability uses its explicit Terra/high profile; runtime
  self-introspection is unavailable with no visible mismatch. It reports two
  P1s: enterprise GitHub web/API endpoints may use unrelated origins, and JWKS
  cache entries never expire or follow response cache directives. It also
  reports finite URL/scope/API-version bounds and the Google-scope README
  contradiction as P2.
- TypeScript/API uses its explicit Terra/high profile with unavailable
  self-introspection and no visible mismatch. It reports a P2 contract defect:
  string-valued `email_verified` is retained although only verified booleans
  may be normalized. It independently confirms the README scope contradiction
  and finds no other export/dependency/declaration issue.
- Documentation uses its immutable Luna/medium profile; runtime
  self-introspection is unavailable. It reports four P2s: the Google scope
  contradiction, missing runnable custom/Google/GitHub examples, missing
  finite/cache/endpoint/token-zeroing guidance, and missing per-field public
  provider TSDoc.
- Performance/reliability uses its explicit Terra/high profile with unavailable
  self-introspection and no visible mismatch. It reports two P1s: losing async
  HTTP/body work may resume after the bounded operation returns, and permanent,
  unsynchronized JWKS caching permits stale trust and out-of-order publication.
  Its focused pnpm command was blocked by the workspace link-config change; it
  made no changes and ran no JVM command.
- One aggregated correction batch will gate/cancel late HTTP/body work, add
  cache-directive-aware expiring single-flight JWKS publication, require
  coherent enterprise origins, bound public strings/collections, enforce
  boolean-only `email_verified`, and complete README/TSDoc/examples. All four
  concerns reopen once on the corrected package.
- Residual style/maintainability and performance/reliability review both find
  that the first waiter's abort signal owns the shared JWKS single-flight and
  can invalidate a concurrent valid exchange. Reliability also requires body
  cancellation when status, media type, or declared size rejects a response
  before reader acquisition.
- Residual TypeScript/API review finds that runtime object spreading permits a
  hidden Google `discoveryEndpoint`, and GitHub needs exact runtime array/
  boolean validation for scopes and verified-primary-email lookup.
- The final correction uses operation-owned shared JWKS cancellation with
  independently abortable waiters, cancels all early-rejected bodies, forwards
  only declared Google options, and validates exact GitHub runtime shapes.
  Provider tests pass 73/73 at 90.51% branches; the full auth suite passes
  297/297. TypeScript, TypeDoc/API inventory at 102 exports, semantic snippets,
  repository formatting, and diff hygiene pass. Style, API, reliability, and
  documentation receive the exact final C4 package for closure.
- TypeScript/API closure is clean. The existing reviewer ran with its explicitly
  dispatched `gpt-5.6-terra` / `high` profile; runtime self-introspection was
  unavailable with no visible mismatch. It confirms the Google allowlist,
  GitHub runtime-shape validation, exports, and TypeDoc contract without a
  substantive regression.
- Reliability confirms the implementation correction but requests one P2
  regression for last-waiter cancellation and subsequent fresh JWKS fetch. The
  deterministic test is added and passes. Focused provider evidence is now
  74/74 at 91.24% branches and 100% lines; only reliability reopens for this
  test-only correction.
- Reliability closure is clean under its explicitly dispatched existing
  `gpt-5.6-terra` / `high` profile; runtime self-introspection is unavailable
  with no visible mismatch.
- Style closure reports one P2: a supplied client secret is not bounded when
  PKCE-only mode does not use it, and the raw option remains captured. The
  correction validates any supplied secret and captures only the validated
  value. Provider tests pass 76/76 at 91.36% branches and 100% lines;
  TypeScript and diff hygiene pass. Only style and API reopen.
- Style closure is clean under its explicitly dispatched existing
  `gpt-5.6-terra` / `high` profile; runtime self-introspection is unavailable
  with no visible mismatch. The reviewer confirms supplied-secret bounds,
  required secret-auth behavior, validated-value capture, and regressions.
- Final API review reports that GitHub still captures its raw options object
  through the email flag and asks for missing-secret coverage in Basic mode.
  Documentation reports that the advertised runnable provider example leaves
  application mapping/session seams undeclared and constructs only a Google
  flow. The correction copies the validated GitHub flag, covers both required
  secret modes, defines typed application seams, and constructs explicit/
  discovered custom, Google, and GitHub flows. The auth README now participates
  in semantic snippet checking. API, style, and documentation reopen only.
- Final style re-review is clean under its explicit existing
  `gpt-5.6-terra` / `high` profile; runtime self-introspection is unavailable
  with no visible mismatch. The returned GitHub provider captures validated
  locals rather than the raw options object or secret.
- Final TypeScript/API re-review is clean under its explicit existing
  `gpt-5.6-terra` / `high` profile; runtime self-introspection is unavailable.
  GitHub retains validated locals only, both secret-auth modes reject a missing
  secret, and no public type, export, or TypeDoc regression remains.
- Final documentation re-review is clean under its immutable existing
  `gpt-5.6-luna` / `medium` profile; runtime self-introspection is unavailable.
  The typed application seams and all four provider-flow paths compile
  semantically, and no limits/defaults/security guidance regression remains.
  All relevant C4 specialist concerns are closed.
- Canonical generated coverage passes 150 test files / 2,935 tests, with 3
  files / 25 tests skipped and 90.11% branch coverage (9,786/10,859). C4 is
  accepted; final Wave 4 security remains deferred to the complete Wave
  boundary.

## C5.1 browser session integration review

- C5.1 is high-risk because it adds public browser credential/session and
  reconnect lifecycle contracts.
- Style/maintainability: existing reviewer, explicitly expected
  `gpt-5.6-terra` / `high`.
- TypeScript/API: existing reviewer, explicitly expected `gpt-5.6-terra` /
  `high`.
- Performance/reliability: existing reviewer, explicitly expected
  `gpt-5.6-terra` / `high`.
- Documentation: existing reviewer with immutable expected
  `gpt-5.6-luna` / `medium`.
- Each dispatch is read-only and limited to `packages/client-web` C5.1 source,
  tests, README, export inventory, and implementation report. Runtime metadata
  will be recorded before acceptance; final Wave 4 security remains deferred.

### Complete wave findings

- Style/maintainability used the explicitly dispatched existing
  `gpt-5.6-terra` / `high` profile; runtime self-introspection was unavailable
  with no visible mismatch. It reports two accepted P2 findings: the public
  callback/type names violate the required `on`/`On` convention, and the
  cancellation test does not prove that the live hook signal aborts or that a
  second Subscribe is suppressed.
- TypeScript/API used the explicitly dispatched existing
  `gpt-5.6-terra` / `high` profile; runtime self-introspection was unavailable
  with no visible mismatch. It reports one accepted P2: a public `readonly`
  parameter property is still mutable at JavaScript runtime, allowing a bearer
  session's credential mode to be changed after construction.
- Performance/reliability used the explicitly dispatched existing
  `gpt-5.6-terra` / `high` profile; runtime self-introspection was unavailable
  with no visible mismatch. It reports one accepted P1: a non-cooperative
  reconnect hook is awaited directly and can keep recovery pending forever
  despite the finite retry policy.
- Documentation used the immutable existing `gpt-5.6-luna` / `medium`
  profile; runtime self-introspection was unavailable. README snippets compile
  and the documented session behavior is otherwise current. It reports two
  accepted P2s: generic hooks are described as inherently bounded although
  only the session helper bounds its own HTTP work, and token redaction is
  described more broadly than the errors wrapped by session HTTP handling.
- One deduplicated correction batch resolves all accepted findings. Only style,
  TypeScript/API, and performance/reliability reopen for substantive runtime
  and public-contract changes. Documentation wording is mechanically
  verifiable through the semantic snippet gate and does not require another
  documentation review unless the correction changes the documented contract.

### Corrected candidate and targeted re-review

- The original implementer used its explicitly dispatched
  `gpt-5.6-terra` / `medium` profile; runtime self-introspection remained
  unavailable with no visible mismatch. It resolves the complete batch with a
  child cancellation signal, remaining-retry-budget deadline, private
  credential mode, corrected callback names, exact cancellation/exhaustion
  regressions, and qualified README claims.
- Independent evidence passes 2 files / 86 tests, 347/383 focused branches
  (90.60%), root generated TypeScript build, client-web dependency boundary,
  semantic snippets, API inventory at 22 client-web exports, Prettier, and diff
  hygiene.
- Style/maintainability, TypeScript/API, and performance/reliability reopen
  narrowly against the corrected C5.1-owned files. Each uses the existing
  reviewer role with explicitly expected `gpt-5.6-terra` / `high`.
  Documentation stays closed because the accepted wording changes are
  mechanically verified and introduce no new behavioral claim. Runtime
  metadata will be recorded before accepting each result.

### Targeted re-review findings

- TypeScript/API uses its explicit existing `gpt-5.6-terra` / `high` profile;
  runtime self-introspection is unavailable with no visible mismatch. It finds
  one P1: after the reconnect callback resolves, recovery does not re-sample
  the injected scheduler, so callback work that consumes the remaining elapsed
  budget may still be followed by a second Subscribe.
- Style/maintainability uses its explicit existing `gpt-5.6-terra` / `high`
  profile; runtime self-introspection is unavailable with no visible mismatch.
  It finds one P1 test gap: cancellation never settles the ignored callback
  afterward, so the test does not prove that late completion is detached and
  cannot reconnect.
- Performance/reliability uses its explicit existing `gpt-5.6-terra` / `high`
  profile; runtime self-introspection is unavailable with no visible mismatch.
  It confirms the scheduler-budget P1 and finds one additional P1:
  `BrowserSession.#run()` attaches its late-rejection sink only after the race
  succeeds, allowing an abort-ignoring Fetch/adapter that rejects after
  timeout, cancellation, or close to become an unhandled rejection.
- One final targeted batch adds the post-hook elapsed guard and
  scheduler-advance regression, attaches the session operation rejection sink
  immediately, and proves late completion/rejection after cancel/timeout. No
  other API, style, or reliability concern remains open.

### Final correction evidence and residual closure

- The original implementer used its explicit existing
  `gpt-5.6-terra` / `medium` profile; runtime self-introspection is unavailable
  with no visible mismatch. The three-item batch is implemented.
- Independent evidence passes 2 files / 89 tests, 349/385 focused branches
  (90.64%), root generated TypeScript build, client-web dependency boundary,
  semantic snippets, API inventory at 22 exports, Prettier, and diff hygiene.
  Full client-web ESLint still reports the documented pre-existing package
  baseline; the correction introduces no new violation.
- Style, TypeScript/API, and performance/reliability perform residual-only
  checks of the post-hook scheduler guard, immediate late-rejection sink, and
  deferred-callback cancellation regression under their original explicit
  `gpt-5.6-terra` / `high` profiles. Documentation remains mechanically
  closed. Runtime metadata will be recorded before final acceptance.
- Residual TypeScript/API is clean under its explicit existing Terra/high
  profile. Residual style and reliability accept all runtime corrections but
  identify one final test-only item: the deferred cancellation regression
  rejects late but does not resolve late and prove that lifecycle remains
  terminal without later `connecting`/`connected` notices.
- The original implementer receives exactly one deterministic late-success
  lifecycle regression. This test-only correction reopens style and reliability
  for residual closure only; API and documentation remain clean.
- The late-success regression is implemented without a runtime/API change.
  Independent evidence passes 2 files / 90 tests, 349/385 branches (90.64%),
  client-web typecheck, Prettier, and diff hygiene. Style and reliability
  perform one residual-only sign-off against this test; their explicit expected
  profiles remain Terra/high.
- The first final style dispatch is rejected as invalid: it reports duplicate
  files under `packages/client/**`, but that path does not exist in the T-0075
  worktree and has no tracked or changed files. `git status`, `git ls-files`,
  and `git diff --name-only` confirm the only scoped paths are
  `packages/client-web/**`. This is a visible workspace/scope mismatch under the
  protocol's acceptance gate, so the result is not a finding. Style is
  redispatched with the absolute task-worktree path and exact files.
- Correct-scope final style and reliability sign-offs are clean under their
  explicit Terra/high profiles; runtime self-introspection is unavailable with
  no visible mismatch. The late-success test proves one Subscribe, child-signal
  abort, terminal `closed`, iterator completion, and no later reconnect state.
  TypeScript/API remains clean; documentation remains mechanically closed.
  C5.1 review is converged.

## C5.3 Chat Projection backend review

- C5.3 changes public application Protobuf models, Aggregate/Projection
  behavior, Query/subscription example behavior, finite input validation, and
  public example documentation. Style/maintainability, TypeScript/API,
  documentation, and performance/reliability are all relevant.
- Each reviewer uses its existing role. Expected and explicit profiles are
  `gpt-5.6-terra` / `high` for style, TypeScript/API, and
  performance/reliability, and the immutable `gpt-5.6-luna` / `medium` for
  documentation. Runtime metadata will be recorded before acceptance.
- Pre-review lint confirms no forbidden end-user envelopes, `packCommand`,
  `packEvent`, schema-bearing decorators, `@Apply`, manual transactions,
  internal event IDs, default-route ID extraction, or handler materialization
  in the changed Chat application source/docs. Chat ESLint and Prettier pass.
  The repository-wide cleanup script exits nonzero only on already committed
  auth/client-node findings outside this slice and reports no Chat path.
- Independent evidence passes model/handler generation, both package builds,
  the real loopback integration plus direct validation suite at 2 files /
  25 tests, and 18/18 validation branches (100%). The real integration retains
  generated-`dist` execution because Vitest cannot collect the standard
  decorator-bearing source; no fake handler invocation replaces it.
- Review scope is limited to the changed Chat Proto sources, application
  source/tests/README, C5.3 report, and the frozen C5/parent plan. Historical
  text and concurrent C5.1 files are not findings. No Spine JVM command is
  permitted; final Wave 4 security remains deferred.

### Complete C5.3 wave findings and dispositions

- Style/maintainability used its explicit existing Terra/high profile; runtime
  self-introspection was unavailable with no visible mismatch. It reports an
  accepted P1 for the missing D3 trusted author/room policy, plus accepted P2s
  for accidental public validation-limit exports and missing multibyte
  UTF-8-boundary tests.
- TypeScript/API used its explicit existing Terra/high profile; runtime
  self-introspection was unavailable with no visible mismatch. It confirms the
  room-subscription negative-delivery and UTF-8/no-publication gaps. It also
  reports an in-place v1 wire-compatibility P1. That compatibility finding is
  rejected for this unpublished example because the human explicitly removed
  migration/deprecation compatibility requirements and no npm package or
  persisted production data exists; README/report must nevertheless state that
  the example model was intentionally reset without migration compatibility.
  D3 remains mandatory and is not waived.
- Documentation used the existing role's immutable Luna/medium profile; the
  dispatch surface does not accept a Luna model override, and runtime
  self-introspection was unavailable. Its single accepted P2 requires the
  README/report to state the current client-supplied author limitation and the
  application gateway's auth/identity ownership; the final corrected text must
  describe the implemented D3 policy rather than merely defer the gap.
- Performance/reliability used its explicit existing Terra/high profile;
  runtime self-introspection was unavailable with no visible mismatch. It
  confirms the D3 and room-negative-delivery P1s, adds a P1 for unrestricted
  deterministic `MessageId` reuse overwriting state and republishing events,
  and adds a P2 to prove no Aggregate/Projection/subscription publication for
  rejection classes.
- Accepted correction behavior is one bounded D3/example batch:
  application-owned gateway policy and context resolver validate mapped actor
  and permitted room for Post/Query/Subscribe; spoofed/cross-room access is
  denied before forwarding; reused message IDs are rejected atomically before
  mutation/publication; room-B produces no room-A delivery; multibyte bounds
  and rejection non-publication are proved; internal constants stop leaking;
  docs state trust ownership and the intentional unpublished model reset.
  Activate/Cancel retain the already implemented gateway binding-owner checks
  and do not invent handler-level authentication.

## C5.2 React adapter review

- Coordinator pre-review evidence passes 13/13 focused tests at 24/24 branches
  and 100% lines, typed ESLint, package TypeScript, dependency isolation,
  package metadata, semantic snippets, exact TypeDoc/API inventory, formatting,
  and diff hygiene.
- Style/maintainability ran read-only under an explicit CLI runtime banner of
  `gpt-5.6-terra` / `high`; runtime self-introspection was unavailable. It
  reports one accepted P1: a request scheduled in the effect microtask can
  still be invoked after immediate cleanup because liveness is checked only
  when publishing.
- TypeScript/API ran read-only under an explicit CLI runtime banner of
  `gpt-5.6-terra` / `high`; runtime self-introspection was unavailable. It is
  clean for the public package contract, declarations, TypeDoc/export
  inventory, peer dependency, and runtime/type agreement.
- Performance/reliability ran read-only under an explicit CLI runtime banner
  of `gpt-5.6-terra` / `high`; runtime self-introspection was unavailable. It
  reports an accepted P1 because activation or iterator terminal failures
  publish an error but do not cancel the live subscription. It reports two
  accepted P2s: synchronous `cancel()` throws escape the current cleanup
  expression, and the React test proves only entity factory arguments rather
  than observed reconnect/resynchronization behavior.
- Documentation ran read-only under an explicit CLI runtime banner of
  `gpt-5.6-luna` / `medium`; runtime self-introspection was unavailable. Its
  accepted P2 corrects stale pre-correction test/coverage figures presented
  alongside final evidence in the implementation report.
- One consolidated correction batch returns to the original C5.2 implementer:
  guard liveness before request invocation; cancel exactly once on activation
  or either iterator's fatal failure while retaining the original error; make
  cancellation safe for synchronous throws and rejected promises; prove the
  browser client's authoritative Entity reconnect produces an observed
  `resynchronization` delivery while Event gaps remain notification-only; and
  mark/remove superseded report figures. Style and reliability reopen after
  behavior correction. TypeScript/API stays clean; the report-only docs fix is
  mechanically verified and does not reopen documentation.

## C5.3 S1 Aggregate latest-state review

- S1 is package-internal but changes Aggregate persistence/read-after-write,
  lifecycle restoration, and same-context ordering. Style/maintainability and
  performance/reliability are relevant. TypeScript/API is N/A because no
  public declaration/export changes. Documentation is N/A because S1 changes
  no end-user workflow or current concurrency claim; C5.3 example docs remain
  in the parent review.
- Existing `style_maintainability_reviewer` is explicitly dispatched read-only
  as `gpt-5.6-terra` / `high`; existing
  `performance_reliability_reviewer` is explicitly dispatched read-only as
  `gpt-5.6-terra` / `high`. Scope is only the S1 report and exact Stand,
  repository, and focused-test diff. Reviewers may not edit, spawn, inspect
  unfinished Chat/auth/React, or run any Spine JVM command. Runtime metadata
  will be recorded before accepting results.

### Complete S1 findings and disposition

- Both runtime banners confirm the explicit existing reviewer profiles:
  style/maintainability and performance/reliability used
  `gpt-5.6-terra` / `high`. Runtime self-introspection was unavailable with no
  visible mismatch.
- Both reviewers accept the Stand-authoritative internal design and report no
  implementation defect. Accepted test findings are consolidated as one
  correction: exercise archived/deleted lifecycle restoration through a
  generated Aggregate handler; exercise concurrent same-ID FIFO behavior with
  exactly one accepted update and one domain rejection and no rejected
  overwrite/publication; and exercise same-ID, second-command rehydration
  independently in two tenants.
- TypeScript/API remains N/A because no public declaration/export changed.
  Documentation remains N/A because this internal correction changes no
  end-user workflow or current public claim. Style and reliability reopen only
  for the residual generated-handler regressions.

## C5.2 residual and C5.3 A1 review dispatch

- C5.2 residual style/reliability and complete A1 style/reliability are assigned
  to the existing concern roles with explicit `gpt-5.6-terra` / `high`
  profiles. Review is read-only and scoped to the recorded findings, exact
  changed React/auth files, implementation reports, and current mechanical
  evidence.
- A1 TypeScript/API and documentation remain relevant because the optional
  fixed registry is a public constructor contract and its safe scope is an
  end-user claim. Expected profiles are explicitly
  `gpt-5.6-terra` / `high` for TypeScript/API and
  `gpt-5.6-luna` / `medium` for documentation. They dispatch when capacity is
  available.
- C5.2 TypeScript/API retains its earlier clean disposition. Its evidence-only
  documentation finding is mechanically closed by the superseding final
  report section and does not reopen documentation.

### Style and reliability results

- Both reviewers ran under explicit existing `gpt-5.6-terra` / `high`
  profiles; runtime self-introspection was unavailable with no visible
  mismatch.
- A1 is clean in both concerns: the fixed registry remains bounded to
  independent policy/context command decodes, real native composition forwards
  once, and registry/credential data is not forwarded.
- C5.2 accepts one P1: check generation liveness before invoking the scheduled
  subscription factory, with an immediate-unmount regression proving no
  invocation. Accepted P2 test evidence must prove activation, delivery, and
  lifecycle fatal paths each request exactly one safe cancellation and retain
  the primary error even when cleanup throws or rejects. One consolidated
  correction reopens style and reliability only.
- S1 accepts one residual evidence correction: observe exactly one normal
  event and exactly one `TaskAlreadyDone` rejection in the EventStore for the
  concurrent same-ID pair, alongside the existing FIFO/final-state/version
  assertions. Production design remains accepted; style and reliability reopen
  only for this test.

### A1 TypeScript/API result

- The reviewer ran under the explicit existing `gpt-5.6-terra` / `high`
  profile; runtime self-introspection was unavailable with no visible
  mismatch.
- Accepted P1: capture `UnaryGatewayOptions.registry` immutably at construction
  instead of rereading the caller-owned options object after an await. Add a
  mutation-during-session-resolution regression proving all independent views
  retain the construction-time registry.
- Accepted P2: TSDoc must explicitly include both authorization policy and
  context resolver collaborators. Type-only declaration resolution, exact
  public inventory, unknown/malformed behavior, native composition, and
  registry/credential non-forwarding are otherwise clean.

### A1 documentation result and complete disposition

- The existing documentation concern used its immutable configured
  `gpt-5.6-luna` / `medium` role; the generic spawn surface did not accept a
  literal Luna override. Runtime self-introspection was unavailable with no
  visible mismatch.
- README and report claims are clean. The single accepted P2 duplicates the
  API finding that TSDoc must name both policy and context collaborators.
- A1's one correction batch is therefore: capture the registry immutably at
  construction, prove options mutation during awaited session resolution
  cannot change any request view, and correct TSDoc. Style/reliability remain
  clean. TypeScript/API and documentation reopen for these residual items only.

## C5.2/S1 residual review result

- Style/maintainability is clean for both scopes under explicit
  `gpt-5.6-terra` / `high`; runtime self-introspection was unavailable with no
  visible mismatch.
- Reliability is clean for S1 under the same explicit profile. S1 review is
  converged.
- React accepts one final P2 test correction: for activation-, delivery-, and
  lifecycle-fatal sources crossed with synchronous-throwing and rejected
  cancellation, assert the observed error is the exact original fatal object
  and cancellation occurs once. Production behavior is not reopened.

## C5.3 A1 residual sign-off

- TypeScript/API is clean under the explicit
  `gpt-5.6-terra` / `high` profile. Documentation is clean under its immutable
  `gpt-5.6-luna` / `medium` profile. Runtime self-introspection was unavailable
  with no visible mismatch.
- The construction-time registry snapshot, caller-mutation regression,
  independent source/policy/context views, corrected public TSDoc,
  README/report agreement, exact export inventory, and non-forwarding behavior
  are accepted. A1 review is converged.

## C5.2 final reliability assertion

- Reliability retains one P2 test-only finding: after observing each fatal
  path's one cancellation, unmount the render and prove effect cleanup does not
  invoke cancellation again. All six fatal-source/cancel-mode cases require
  the post-unmount exactly-once assertion. Production, API, style, and
  documentation are not reopened.

## C5.3 corrected Chat final review dispatch

- Final candidate evidence is 32/32 focused real tests, 18/18 validation
  branches, generated model/handler workflows, both package builds, typed lint,
  snippets, formatting, and diff hygiene. Domain rejection is correctly
  asserted through EventStore while transport post remains acknowledged.
- Style/maintainability, TypeScript/API, documentation, and
  performance/reliability all reopen for the corrected complete application
  slice. Explicit expected profiles are `gpt-5.6-terra` / `high` for style,
  API, and reliability, and immutable `gpt-5.6-luna` / `medium` for
  documentation. Review is read-only and no Spine JVM command is permitted.

### Complete C5.3 findings and disposition

- All configured profiles match the dispatch: Terra/high for style, API, and
  reliability; immutable Luna/medium for documentation. Runtime
  self-introspection was unavailable with no visible mismatch.
- P1: replace first-match room authorization with a compositional guarantee.
  `ALL` is constrained when any child guarantees an authorized room;
  `EITHER` is constrained only when every non-empty branch does. Add mixed and
  nested bypass regressions for Query and Subscribe.
- P1: prove native Query denial via the real configured unary gateway and
  native Subscribe denial via a real configured subscription gateway before
  backend forwarding/creation. Direct policy calls remain useful but
  insufficient.
- P2: sequential duplicates assert one normal plus one rejection event;
  concurrent duplicates additionally prove no second Projection subscription
  update. Cleanup aggregates and reports failures after attempting every
  resource, and subscription timeout races clear the losing timer.
- P2: add `ChatServerOptions` TSDoc; document the full finite validation set and
  duplicate transport-ack/stored-rejection/no-update behavior; replace stale
  implementation-report evidence with final counts.
- All other Protobuf model/reset, column, generated workflow, public export,
  registry, Post composition, validation, and Projection/event distinctions
  are clean.

## C5.3 residual sign-off dispatch

- The complete corrected candidate passes 3 real-loopback files / 36 tests,
  policy and validation coverage at 100% across every metric, model and handler
  generation, both package builds, typed lint, semantic snippets, formatting,
  and diff hygiene.
- Style/maintainability, TypeScript/API, documentation, and
  performance/reliability reopen only for the consolidated correction:
  recursive/fail-closed room guarantees, real native Query/Subscribe proof,
  exact duplicate event/update assertions, ordered all-attempt cleanup and
  timeout disposal, `ChatServerOptions` TSDoc, README validation/duplicate
  semantics, and final report evidence.
- Existing style, API, and reliability roles are explicitly dispatched at
  `gpt-5.6-terra` / `high`; the existing documentation role is explicitly
  dispatched at its immutable `gpt-5.6-luna` / `medium` configuration.
  Reviewers are read-only, may not spawn children or inspect later Wave 4
  slices, and may not run any Spine JVM command.

### TypeScript/API residual result

- CLEAN under the explicitly dispatched existing
  `typescript_api_docs_reviewer` at `gpt-5.6-terra` / `high`. Runtime
  self-introspection was unavailable with no visible profile mismatch.
- The reviewer accepts the recursive filter contract, configured native
  registry composition, direct test-only Connect dependency,
  `ChatServerOptions` defaults/TSDoc, unpublished Proto reset scope, and
  README/report contract claims.

### Style/maintainability residual result

- The explicitly dispatched existing `style_maintainability_reviewer` ran at
  `gpt-5.6-terra` / `high`; runtime self-introspection was unavailable with no
  visible mismatch.
- P1 is accepted only for decoding forwarded Query/Subscribe bytes and proving
  a freshly resolver-owned timestamp/context object. Its instruction to
  forward conflicting actor/tenant values is rejected: the frozen Wave 4
  contract requires mismatched caller actor/tenant to receive
  `context-stale`/denied before forwarding and forbids silently changing them
  into another identity. Correct evidence therefore proves both mismatch
  rejection before backend work and fresh reconstruction after matching
  actor/tenant hints.

### Documentation residual result

- The existing `documentation_reviewer` ran at its explicitly dispatched
  immutable `gpt-5.6-luna` / `medium` profile; runtime self-introspection was
  unavailable with no visible mismatch.
- Accepted P2: source TSDoc describes `ChatServerOptions`, but the end-user
  README and final implementation report do not explain
  `startChatServer({ host, port })`, the `127.0.0.1`/ephemeral-port defaults, or
  the 1,000-subscription service limit. Add the bounded user workflow/API text.
  Validation, duplicate acknowledgement/rejection/no-update, Projection/event,
  auth ownership, and final 36/36 claims are otherwise consistent.

### Reliability residual result and consolidated correction

- The explicitly dispatched existing `performance_reliability_reviewer` ran at
  `gpt-5.6-terra` / `high`; runtime self-introspection was unavailable with no
  visible mismatch.
- Accepted P1 evidence: correlate the concurrent duplicate winner with final
  Aggregate text and version 1, not only room; exercise mixed/nested
  `EITHER(authorized, unauthorized)` Subscribe through the real
  `SubscriptionGateway` and prove denial before creator invocation.
- Accepted P2 production hardening: the authorization tree is untrusted input,
  so recursive evaluation needs a finite depth/node budget and fail-closed
  regression rather than unbounded stack/work.
- One complete correction batch also includes the corrected style P1
  mismatch-rejection plus matching-context reconstruction assertions and the
  documentation P2 server-start workflow.
  Existing implementer is explicitly assigned at `gpt-5.6-terra` / `medium`;
  it owns only Chat/model/tests/README/report/log files, uses behavior-first
  evidence for the traversal bound, and may not spawn, commit, inspect later
  Wave 4 slices, or run any Spine JVM command.

### Residual correction re-review dispatch

- Corrected evidence passes 21/21 policy/validation tests at 100% coverage in
  every metric and 3 real-loopback files / 37 tests, plus generation, builds,
  typed lint, snippets, formatting, and diff hygiene.
- Style, documentation, and reliability reopen only for their substantively
  affected findings. Existing style and reliability roles are explicitly
  dispatched at `gpt-5.6-terra` / `high`; the existing documentation role is
  explicitly dispatched at immutable `gpt-5.6-luna` / `medium`.
  TypeScript/API remains clean and closed.

### Documentation residual re-review

- The existing documentation role ran at its explicitly configured immutable
  `gpt-5.6-luna` / `medium` profile; runtime self-introspection was unavailable
  with no visible mismatch.
- Server workflow/defaults/limit and matching-versus-mismatched context claims
  are accepted. One P2 stale `36/36` report count is deterministically
  corrected to the verified `37/37`; this record-only correction does not
  reopen implementation or another documentation review.

### Style/reliability residual re-review

- Both existing roles ran under their explicit `gpt-5.6-terra` / `high`
  profiles; runtime self-introspection was unavailable with no visible
  mismatch.
- Style accepts the security and native composition corrections but finds one
  P2: fail-closed decision state is not yet bounded work because array
  `map()` and the top-level loop continue visiting remaining siblings after
  budget exhaustion.
- Reliability accepts native Subscribe denial, mismatch
  rejection/matching-context reconstruction, and duplicate winner
  correlation, and adds one P2 boundary matrix: prove 8 versus 9 composites
  and 16 versus 17 simple filters.
- One final correction returns to the existing implementer context, explicitly
  `gpt-5.6-terra` / `medium`: stop traversal immediately when either budget is
  exhausted and add exact plus wide-tree boundary regressions. Only style and
  reliability reopen. No framework/later-slice edits, children, Git mutation,
  or Spine JVM work are permitted.

### Final bounded-work sign-off dispatch

- Corrected evidence passes 23/23 policy/validation tests at 98.55% branches
  and 100% functions/lines, 3 real-loopback files / 39 tests, typed lint,
  formatting, and diff hygiene.
- Style and reliability reopen only for immediate traversal termination and
  the exact/wide boundary matrix under their explicit existing
  `gpt-5.6-terra` / `high` profiles. Documentation and TypeScript/API remain
  closed.

### Final bounded-work sign-off result

- Style/maintainability and performance/reliability are CLEAN under their
  explicitly dispatched existing `gpt-5.6-terra` / `high` profiles. Runtime
  self-introspection was unavailable with no visible mismatch.
- Immediate traversal termination, exact 8/9 and 16/17 boundaries, and the
  poisoned-wide-sibling regression are accepted. Together with the already
  clean TypeScript/API and documentation dispositions, C5.3 is
  review-converged.

## C5.4 browser Chat review dispatch

- Mechanically accepted candidate: private
  `@spine-event-engine/example-chat-web`, 4/4 component tests, package
  TypeScript, ESLint, formatting, diff hygiene, and 3/3 Playwright projects in
  Chromium, Firefox, and WebKit.
- Style/maintainability, documentation, and performance/reliability are
  relevant. Existing style and reliability roles are explicitly dispatched at
  `gpt-5.6-terra` / `high`; existing documentation is explicitly dispatched at
  immutable `gpt-5.6-luna` / `medium`. TypeScript/API is N/A because this
  private example adds no published framework contract. Reviewers are
  read-only and may not spawn, edit, inspect Slice E/F, or run any Spine JVM
  command.

### Complete C5.4 findings and correction disposition

- Style/maintainability and performance/reliability ran under explicit existing
  `gpt-5.6-terra` / `high` profiles. Documentation ran under its explicit
  immutable `gpt-5.6-luna` / `medium` profile. Runtime self-introspection was
  unavailable with no visible mismatch; no reviewer edited, spawned, or ran
  Spine JVM work.
- Accepted P1: the app launches an independent Query on
  `resynchronizing` while client-web already executes the entity
  subscription's authoritative Query, ignores the resulting
  `resynchronization` delivery, and launches an unbounded independent Query for
  every raw update. Establish one recovery owner, consume authoritative
  recovery state, and coalesce/bound update-triggered refresh.
- Accepted P1: sign-in rejection/late completion and command rejection are
  unhandled. Guard sign-in lifetime and show retryable error state. Retain a
  failed command's payload and deterministic MessageId for retry, and prevent
  concurrent resubmission.
- Accepted P1 evidence: Playwright currently proves render/post/status only.
  In every engine observe exactly one recovery Query, authoritative recovery
  state, unmount cancellation/zero active subscription, and no stale
  publication. Attribute request/timer race evidence honestly to component and
  frozen adapter suites where browser instrumentation does not directly
  observe it.
- Accepted P2 docs: the work log overclaims that Playwright itself proves all
  request/subscription/timer cleanup; correct attribution. README/report are
  otherwise clean.
- Mechanical correction joins the batch: root coverage must include TSX, and
  behavior tests must raise `chat-web/src/index.tsx` from 80% branches and
  86.95% statements to at least 90% without ignore markers.
- One consolidated batch returns to the existing implementer at explicit
  `gpt-5.6-terra` / `medium`, with `examples/chat-web/**`, minimal coverage
  config, report/log ownership. Framework production stays frozen unless a
  separately evidenced blocker is reported. No children, Git, Slice E/F, or
  Spine JVM work is allowed. All three review concerns reopen.

### C5.4 corrected residual dispatch

- Coordinator evidence passes 12/12 focused tests; 96.03% statements, 91.22%
  branches, 100% functions, and 98.85% lines for `index.tsx`; package
  TypeScript, ESLint, formatting, and diff hygiene; and 3/3 real-browser
  projects.
- The corrected application consumes one `resynchronization` response,
  coalesces raw hints to one in-flight plus one pending refresh, guards
  sign-in lifetime/error/retry, retains deterministic command payload/ID across
  rejected or error outcomes, and exposes browser-observed recovery query
  count/state and subscription teardown.
- Style, documentation, and reliability reopen only for these corrections
  under their explicit existing `gpt-5.6-terra` / `high`,
  `gpt-5.6-luna` / `medium`, and `gpt-5.6-terra` / `high` profiles.
  TypeScript/API remains N/A/closed; no Spine JVM work is permitted.

### C5.4 documentation residual result

- CLEAN under the explicit immutable existing `gpt-5.6-luna` / `medium`
  profile; runtime self-introspection was unavailable with no visible
  mismatch.
- Recovery/retry semantics, bounded hint behavior, browser-versus-component
  evidence attribution, exact test/coverage/browser counts, setup, and later
  slice/JVM limitations are accepted.

### C5.4 style residual result

- The existing style role ran under explicit `gpt-5.6-terra` / `high`;
  runtime self-introspection was unavailable with no visible mismatch.
- Recovery ownership, bounded coalescing, sign-in behavior, TSX coverage, and
  browser query/subscription teardown are accepted. One P1 remains: direct
  command post work has no abort/liveness boundary and both completion branches
  can update state after `ChatRoom` unmount. Add a component-owned abort signal
  to `ClientRequest.post`, suppress stale completion, and prove deferred-post
  teardown.

### C5.4 reliability residual result and final correction

- The existing reliability role ran under explicit `gpt-5.6-terra` / `high`;
  runtime self-introspection was unavailable with no visible mismatch.
- P1: the refresh ref is cleared while `query.status` still reflects the
  previous terminal render, before `useEntityQuery` publishes loading. A second
  raw hint can therefore start a concurrent Query. The current test checks only
  the eventual count; it must assert no second send before the active refresh
  settles.
- One final batch returns to the existing implementer at explicit
  `gpt-5.6-terra` / `medium`: establish a real deferred-query serialization
  boundary with at most one pending follow-up, and add component-owned
  Post abort/liveness with deferred unmount proof. Style and reliability reopen
  only; documentation/API remain closed. No framework/later-slice/JVM/Git/
  child work is allowed.

### C5.4 final lifecycle sign-off dispatch

- Coordinator evidence passes 17/17 focused tests and `index.tsx` at 95.12%
  statements, 90% branches, 100% functions, and 98.13% lines; TypeScript,
  ESLint, formatting, diff hygiene; and 3/3 real-browser projects.
- Raw-hint refresh now owns a truly serialized public `request.send` loop with
  one pending flag and unmount abort. Direct Post passes a component-owned
  abort signal and suppresses stale completion after unmount.
- Style and reliability reopen only for these corrections under their explicit
  existing `gpt-5.6-terra` / `high` profiles. Documentation remains clean;
  TypeScript/API remains N/A/closed.

### C5.4 final style result

- The existing style role ran under explicit `gpt-5.6-terra` / `high`;
  runtime self-introspection was unavailable with no visible mismatch.
- P1: room-transition cleanup aborts old refresh/post generations but leaves
  `refreshInFlight`, pending flags/payload, and `posting` ownership state set.
  The new room can permanently queue refreshes and retain a disabled Post
  button/old payload. Add a rerender-to-new-room regression with deferred
  refresh and Post, and reset/remount all room-owned state on room transition.

### C5.4 room/tooling correction evidence

- The keyed room remount now aborts old deferred refresh/Post work, cancels the
  old subscription, discards old payload/latches, and creates a fresh Query,
  subscription, enabled Post UI, payload, and hint path for the new room.
- Focused evidence is 18/18 at 95.12% statements, 90% branches, 100% functions,
  and 98.13% lines. Package TypeScript, ESLint, formatting, and diff hygiene
  pass.
- `tsconfig.eslint.json` now enables JSX and chat-web mocks use callable public
  operation signatures with safe signal narrowing. The broad tooling
  typecheck has zero `examples/chat-web` diagnostics; unrelated baseline
  diagnostics remain separately recorded.

### C5.4 final reliability result and framework prerequisite

- The existing reliability role ran under explicit `gpt-5.6-terra` / `high`;
  runtime self-introspection was unavailable with no visible mismatch.
- It confirms the room-transition P1 and adds one P1 architectural blocker:
  initial `useEntityQuery` calls `ClientRequest.send` without an abort signal.
  The frozen hook suppresses stale publication but cannot terminate the active
  transport request after unmount, so C5.4 cannot meet its explicit invariant.
- Because this requires changing a public React contract, the demonstrated
  blocker goes to the existing `requirements_splitter` under explicit
  `gpt-5.6-sol` / `high` for the smallest idiomatic API/compatibility design.
  The role is read-only and may not edit, spawn, inspect later slices, or run
  Spine JVM work. Implementation resumes only after the prerequisite is
  bounded and recorded.

### Client-react query cancellation prerequisite plan

- The existing requirements splitter ran read-only under explicit
  `gpt-5.6-sol` / `high`; runtime self-introspection was unavailable with no
  visible mismatch.
- Accepted minimal contract: `useRequest` receives
  `(signal: AbortSignal) => Promise<Result>`. Every committed effect generation
  owns one fresh `AbortController`; cleanup retires publication then aborts
  once. `useEntityQuery` forwards the signal through
  `request.send(query(), { signal })`.
- No options shape, overload, optional signal, exported factory alias, or
  client-web change is added. Generic cancellation is documented as
  cooperative; `useEntityQuery` guarantees forwarding. Dependency arrays
  remain caller-owned and unchanged.
- One existing implementer is explicitly assigned at
  `gpt-5.6-terra` / `medium` to client-react source/tests/README/report evidence
  only. Acceptance covers render/immediate-unmount safety, active query abort,
  generic hook signal, Strict Mode, dependency transition, late
  success/rejection fencing, focused coverage/types/lint/dependency/API/docs/
  format/diff. All four C5.2 concerns reopen for this public lifecycle change.

### Client-react query cancellation prerequisite dispatch

- Existing implementer completed the exact planned contract under explicit
  `gpt-5.6-terra` / `medium`; runtime self-introspection was unavailable with
  no visible mismatch. No client-web or generalized cancellation change was
  made.
- Coordinator evidence passes 28/28 focused tests and 93.75% branches, package
  TypeScript, owned typed ESLint, dependency isolation, snippets, package
  metadata, TypeDoc/API inventory with unchanged 11 exports, formatting, and
  diff hygiene.
- Style/maintainability, TypeScript/API, documentation, and reliability reopen
  for this public lifecycle correction. Existing style/API/reliability roles
  are explicitly dispatched at `gpt-5.6-terra` / `high`; existing
  documentation is explicit immutable `gpt-5.6-luna` / `medium`. Review is
  read-only; no edits, children, later slices, or Spine JVM work.

### Client-react cancellation API/reliability results

- TypeScript/API and performance/reliability are CLEAN under their explicitly
  dispatched existing `gpt-5.6-terra` / `high` profiles. Runtime
  self-introspection was unavailable with no visible mismatch.
- The accepted exact declaration, unchanged 11-export inventory, cleanup
  ordering, abort-once behavior, immediate unmount, Strict Mode, dependency
  transition, late-result fencing, cooperative generic semantics, guaranteed
  Entity forwarding, and current TSDoc/README are accepted.

### Client-react cancellation style/documentation results

- Style/maintainability is CLEAN under explicit existing
  `gpt-5.6-terra` / `high`; documentation is CLEAN under explicit immutable
  `gpt-5.6-luna` / `medium`. Runtime self-introspection was unavailable with no
  visible mismatch.
- Minimality, lifecycle ownership, tests, cooperative/guaranteed cancellation
  distinction, dependency responsibility, TSDoc, README, and superseding
  report evidence are accepted. The prerequisite is review-converged.

### C5.4 combined final verification and sign-off dispatch

- Coordinator verification after both lifecycle corrections passes the
  established package gates independently: client-react is 28/28 tests at
  93.75% branch coverage and chat-web is 18/18 tests at 90% branch coverage.
  Package TypeScript, ESLint, dependency isolation, documentation snippets,
  supported-file formatting, and diff hygiene pass.
- Real Playwright acceptance passes 3/3 in Chromium, Firefox, and WebKit,
  proving one authoritative recovery response and subscription teardown. The
  broad tooling typecheck still reports 139 unrelated baseline diagnostics but
  zero diagnostics under `examples/chat-web`.
- The existing style/maintainability and performance/reliability concerns
  reopen only for the combined room-remount and initial-query cancellation
  corrections. Both roles are explicitly dispatched read-only with expected
  `gpt-5.6-terra` / `high`; runtime metadata or the immutable profile and
  self-introspection limitation must be recorded before acceptance.
  Documentation remains CLEAN and TypeScript/API remains N/A because C5.4 is a
  private example and changes no published declaration beyond the separately
  accepted client-react prerequisite. No edits, children, later slices, or
  Spine JVM commands are allowed.

### C5.4 combined final style result

- CLEAN. The existing style/maintainability reviewer ran under the explicitly
  dispatched `gpt-5.6-terra` / `high` profile. Runtime self-introspection was
  unavailable and no visible mismatch occurred.
- The keyed room remount resolves the prior stale room state/latch ownership
  defect. The client-react request generation owns and forwards its abort
  signal without adding an unnecessary abstraction. No P0-P2 finding remains.

### C5.4 combined final reliability result

- CLEAN. The existing performance/reliability reviewer ran under the
  explicitly dispatched `gpt-5.6-terra` / `high` profile. Runtime
  self-introspection was unavailable and no visible mismatch occurred.
- Combined room remount/reset, old-room refresh and Post abort, subscription
  cancellation, fresh-room resources, and initial `useEntityQuery` transport
  abort forwarding are accepted. Deferred-transition regressions cover the
  critical lifecycle boundaries. No P0-P2 finding remains.
- C5.4 is review-converged. Documentation remains CLEAN; TypeScript/API remains
  justified N/A for the private example. The separately public client-react
  prerequisite has clean dispositions in all four canonical concerns.

## Slice E planning gate

- Classification: high-risk network/security/interoperability milestone.
- Existing requirements-splitting role is explicitly dispatched read-only at
  `gpt-5.6-sol` / `high` to produce the smallest implementable decomposition,
  ownership boundaries, behavior-first acceptance, and relevant review lanes.
- Binding scope: configurable Envoy reference, real
  browser-to-gateway-to-Spine-TS behavior, and static-only JVM
  source/descriptor/TS-fixture compatibility evidence. No JVM project build,
  test, generation, dependency resolution, launch, or execution is permitted.
  No edits, Git mutation, or child dispatch is permitted.
- The initial planning turn was interrupted after failing to return a bounded
  result; it made no edits. A narrowed retry retains the explicit
  `gpt-5.6-sol` / `high` profile and asks only for the listener ownership
  decision plus two review-sized implementation/acceptance slices.
- The narrowed split completed under explicit `gpt-5.6-sol` / `high`; runtime
  self-introspection was unavailable with no visible mismatch. No product
  blocker exists. Application-owned listener lifecycle around the existing
  `createNativeGatewayServices()` seam avoids a premature public deployment
  API.
- The durable E brief freezes E1 real Envoy/TS acceptance and E2 static
  JVM/shared-wire evidence. The existing implementation role is explicitly
  dispatched at `gpt-5.6-terra` / `medium` with disjoint owned paths,
  behavior-first evidence, no Git/children, and the absolute no-JVM-operation
  boundary.
- The initial implementation result is not accepted: 4/4 renderer/static tests
  and Envoy validation pass, but no real browser-to-Envoy-to-gateway-to-Chat
  evidence exists. The same explicit `gpt-5.6-terra` / `medium` context is
  narrowed to close this mandatory E1 gap before any specialist dispatch.
- Focused RED proves `createNativeGatewayServices()` cannot register its
  `UnaryGateway` ResolveContext path because it exposes no
  `AuthenticationService` implementation. The brief's conditional public-seam
  exception is activated.
- The existing implementer retains explicit `gpt-5.6-terra` / `medium` and may
  make only the minimal native auth service/export/test/doc correction before
  resuming the real topology. All four canonical concerns reopen for that
  public contract; E1 TypeScript/API is no longer N/A. No listener API or
  unrelated auth redesign is permitted.
- The minimal service seam is GREEN: auth build passes, native gateway tests
  pass 31/31, and the E1 seam regression passes 1/1. It remains pending public
  API/documentation/reliability/style review with the complete E1 candidate.
- The real topology is still absent. The same explicit implementation context
  now owns the next bounded infrastructure increment before browser expansion;
  no specialist review begins yet.
- The topology now starts its owners but the first smoke is red. Retained Envoy
  logs prove a renderer defect rather than TLS/ALPN incompatibility:
  `host.docker.internal` is invalid in the current STATIC cluster and causes
  Envoy to exit. Readiness also needs container-liveness evidence rather than
  TCP alone. The same owner receives this single root-cause correction before
  any browser expansion or review.
- The root-cause correction is mechanically GREEN: renderer 2/2, pinned Envoy
  validation, and real gRPC-Web ResolveContext topology 1/1. DNS resolution,
  explicit auth routing, Docker/TCP readiness, log capture, and cleanup are
  present.
- This is an intermediate milestone only. E1 review remains blocked on real
  Post/Read, Projection subscription, browser/session/security, and Connect
  acceptance.

## E1 implementation update — review input

- The existing implementer (`gpt-5.6-terra` / `medium`; runtime
  self-introspection unavailable) now supplies serial cross-browser opaque
  cookie lifecycle evidence plus a Chromium credential, origin, ownership,
  context-rejection, and abrupt-disconnect matrix. No review disposition is
  implied by this implementation record.
- Explicit limitation for reviewers: Chat rejects tenant-bearing subscriptions,
  and this candidate lacks per-operation zero-delta counter assertions and a
  sanitized forwarded-context rewrite observation. Connect remains out of
  scope.

## Slice E complete specialist review dispatch

- The preceding intermediate E1 limitations are superseded. The completed
  candidate provides separated per-operation zero-delta negative groups,
  sanitized forwarded-context evidence, and an explicit Chromium Connect
  unary smoke without probing or fallback. Chat remains intentionally
  tenantless, so a matching-tenant rewrite is not claimed; fabricated tenant
  rejection is covered.
- Coordinator mechanical evidence is green: the exact pinned Envoy image
  validates the rendered configuration; real topology passes 1/1; the serial
  browser matrix passes 9 tests with 12 intentional focused-engine skips;
  focused auth/client evidence passes 169/169; static renderer/wire evidence
  passes 6/6; fixture/descriptor evidence passes 13/13; Proto checksums pass
  40/40; package TypeScript builds, dependency isolation, formatting, and diff
  hygiene pass. The accepted Envoy CORS-field deprecation and bounded E2
  provenance limitation are explicit.
- Existing concern `style_maintainability_reviewer` is explicitly dispatched
  read-only with expected/configured `gpt-5.6-terra` / `high`; existing concern
  `typescript_api_docs_reviewer` with expected/configured
  `gpt-5.6-terra` / `high`; existing concern
  `performance_reliability_reviewer` with expected/configured
  `gpt-5.6-terra` / `high`; and existing concern `documentation_reviewer` with
  immutable expected/configured `gpt-5.6-luna` / `medium`.
- Every dispatch field is explicit. Reviewers must inspect the complete Slice E
  diff from `4a246df0`, the binding human-requirements ledger in
  `E_TASK_BRIEF.md`, both implementation reports, and the affected auth,
  client-web, browser/topology, Envoy, and static-wire paths. They may not edit,
  spawn children, mutate Git, inspect later-slice work, or run any JVM-family
  command, build, test, generation, launch, download, or dependency resolution.
  Runtime self-introspection or the immutable configured profile plus its
  limitation must be recorded before accepting a result.

### Slice E style/maintainability result

- One P2 is confirmed. The TLS Vite configuration at
  `examples/chat-web/test/interop/browser/vite.config.mjs:3` is compressed into
  a 184-character line, and the new candidate must correct it together with
  any other new non-literal lines reported by the repository's 120-character
  line-length gate.
- Runtime self-introspection is unavailable. The immutable configured existing
  role/profile is `style_maintainability_reviewer`,
  `gpt-5.6-terra` / `high`; no visible mismatch or fallback occurred.

### Slice E documentation dispatch surface limitation

- The documentation dispatch explicitly requested the required
  `gpt-5.6-luna` / `medium` profile, but the desktop subagent override API
  rejected `gpt-5.6-luna` before creating an agent because its override
  allowlist exposes only Sol and Terra.
- No wrong-profile agent was accepted. The existing
  `documentation_reviewer` role is itself immutably configured to
  `gpt-5.6-luna` / `medium`; it is redispatched through that fixed role with
  both expected fields explicit in the assignment text and without an
  incompatible model substitution. The API limitation remains part of the
  acceptance record.

### Slice E TypeScript/API result

- One P2 is confirmed. `Client.forConnect()` now unconditionally selects
  binary Connect, but its TypeDoc and public client documentation say only that
  the endpoint must support Connect. The correction must state in
  `packages/client-web/src/client/client.ts`,
  `packages/client-web/README.md`, `docs/api/README.md`, and
  `docs/USER_GUIDE.md` that it uses binary Connect
  (`application/proto`), that the gateway must permit it, and that selection
  remains explicit with no probing or fallback. Packed `Any` command/query
  calls are the reason for the binary requirement.
- No P0/P1 finding exists. The ResolveContext service addition, public native
  service shape, subscription-update rewriting, and static Proto evidence
  seams are contract-consistent.
- Runtime self-introspection is unavailable. The immutable configured existing
  role/profile is `typescript_api_docs_reviewer`,
  `gpt-5.6-terra` / `high`; no visible mismatch or fallback occurred.

### Slice E documentation result

- One P2 is confirmed. Fresh-user/operator documentation does not explain the
  configurable Envoy/gateway topology: renderer inputs, TLS files, gateway-only
  routes, HTTP/2 upstream, pinned-image validation, and application-owned
  gateway listener lifecycle. The correction must add a concise setup guide or
  linked section with commands/code and the explicit customizable-template and
  no-public-backend-route limits.
- The reviewer independently corroborates the TypeScript/API binary Connect
  documentation finding. No additional P0/P1/P2 finding exists, and the E2
  report accurately limits its static compatibility claims.
- Runtime self-introspection is unavailable. The immutable configured existing
  role/profile is `documentation_reviewer`,
  `gpt-5.6-luna` / `medium`; no visible mismatch or fallback occurred. The
  documented desktop override limitation did not substitute another model.

### Slice E performance/reliability result

- One P1 is confirmed in
  `examples/chat-web/test/interop/harness.mjs`. Cleanup ownership begins after
  resources are acquired, the post-container failure path does not remove the
  container, and returned cleanup short-circuits on its first rejection.
  Correction requires one owner from the first acquired resource, unconditional
  reverse-order cleanup, binding cancellation/closure before waiting for
  gateway connection drain, a bounded shutdown, aggregate reporting after all
  attempts, and fault-injection regressions for pre-listen failure,
  post-container startup failure, and one cleanup rejection.
- One P2 is confirmed in
  `examples/chat-web/test/interop/browser/run.mjs`: the Playwright child promise
  observes only `exit`, so a `spawn` error can leave the topology pending
  indefinitely. Correction must reject on `error` and add a focused launch
  failure regression or bounded injectable process seam.
- Runtime self-introspection is unavailable. The immutable configured existing
  role/profile is `performance_reliability_reviewer`,
  `gpt-5.6-terra` / `high`; no visible mismatch or fallback occurred.

### Slice E consolidated correction dispatch

- One complete accepted batch returns to the original existing `implementer`
  context. Expected/configured model is explicitly `gpt-5.6-terra`; reasoning
  is explicitly `medium`. It owns only the affected Slice E implementation,
  focused tests, public documentation, and evidence records.
- Required corrections are: the P1 topology cleanup/fault-injection batch; the
  P2 Playwright spawn-error path; the P2 new-line-length findings; the P2 binary
  Connect public documentation; and the P2 Envoy/operator topology guide.
  Corroboration of binary Connect is one finding, not a duplicate.
- The owner must run focused mechanical and behavior verification, must not
  commit/push/merge or spawn children, and must not run any JVM-family command,
  build, test, generation, launch, download, or dependency resolution. All
  four concerns reopen only where substantively affected; complete corrected
  evidence returns to the coordinator before targeted re-review.

### Slice E incomplete correction handoff

- The original implementer returns after only reformatting the Vite
  configuration and adding binary Connect/no-fallback TypeDoc. The P1 cleanup
  ownership and fault injection, P2 Playwright spawn error, public binary
  Connect documentation, operator topology guide, and focused verification are
  all missing, so the result is rejected.
- The same implementation context is redispatched with the complete remaining
  batch under its unchanged explicitly configured
  `gpt-5.6-terra` / `medium` profile. Runtime self-introspection was not
  included in the incomplete handoff; the immutable configured role/profile is
  retained and no visible mismatch occurred. No acceptance or re-review begins
  until the full correction evidence returns.
- The second turn completes the three public binary Connect documentation
  updates but again returns before reliability work. This remains incomplete.
  To fit the execution surface without changing ownership, the same context is
  narrowed first to the P1 topology cleanup plus its three fault-injection
  regressions. The P2 spawn error and operator guide remain queued immediately
  afterward under the same profile and scope.
- The third turn labels the bounded lifecycle refactor and dependency-injection
  tests a blocker without identifying an environmental, authority, or product
  decision impediment. Difficulty is not a protocol blocker, and no additional
  P1 edit was made. Runtime self-introspection is unavailable; the reported
  configured profile remains `gpt-5.6-terra` / `medium`.
- After three incomplete correction turns, harness ownership transfers to a
  replacement existing `implementer`, explicitly expected/configured
  `gpt-5.6-terra` / `medium`, with the same narrow P1 paths and no-JVM/Git/child
  constraints. The replacement must preserve valid current edits and need not
  rediscover or redesign the already-recorded behavior.
- The remaining independent P2 corrections are dispatched in parallel to a
  second existing `implementer`, explicitly expected/configured
  `gpt-5.6-terra` / `medium`, with disjoint ownership of
  `examples/chat-web/test/interop/browser/run.mjs`, its focused process test,
  the new Envoy operator guide and only the required documentation links.
  This owner must preserve the completed binary Connect docs and must not edit
  the harness P1 paths, commit/Git, spawn children, or run JVM-family work.

### Slice E consolidated correction implementation results

- The replacement P1 owner completed the harness lifecycle correction under
  explicit existing implementer `gpt-5.6-terra` / `medium`. Runtime
  self-introspection is unavailable; the immutable configured profile is the
  available evidence, with no visible mismatch.
- One cleanup owner now exists from first acquired resource, performs
  dependency-safe bounded attempts across every acquired owner, continues
  after failures, and raises an `AggregateError` only afterward. Startup
  failures use the same path. Three deterministic regressions pass for
  pre-listen failure, post-container readiness failure, and a cleanup rejection
  with all later cleanup still attempted. Focused Node tests pass 3/3;
  formatting, owned ESLint, and diff hygiene pass.
- The independent P2 owner completed Playwright spawn-error rejection and
  topology cleanup proof, added the Envoy/gateway operator guide and required
  links, and preserved the binary Connect documentation. It ran under explicit
  existing implementer `gpt-5.6-terra` / `medium`; runtime self-introspection
  is unavailable and no mismatch is visible. Focused Node tests pass 4/4;
  formatting, owned ESLint/syntax, and diff hygiene pass.
- Coordinator verification and targeted re-review follow. Reliability reopens
  for both lifecycle changes; style reopens for owned formatting/line length;
  documentation reopens for operator/binary Connect text; TypeScript/API
  reopens for the public TypeDoc and binary Connect contract wording.

### Slice E clean-browser verification correction

- Clean verification invalidated a stale Vite dependency-cache success:
  `examples/chat-web/test/interop/browser/entry.ts` directly imports
  `@connectrpc/connect` and `@connectrpc/connect-web`, but the example had not
  declared them. Both already-pinned `2.1.2` dependencies and exact lockfile
  importer entries are now present. A frozen-lockfile install passes
  supply-chain verification and reuses all 370 packages locally; the clean
  Vite production bundle transforms 244 modules successfully.
- Playwright's implicit tsconfig discovery traversed the root project-reference
  graph and failed on an unrelated package reference after its Vite server was
  healthy. The interop Playwright configuration is JavaScript, explicitly pins
  its local reference-free `tsconfig.json`, and matches only
  `browser.spec.mjs`; the Node launcher regression remains a separate Node
  test. The launcher regression passes 2/2.
- Independent real topology passes 1/1. Each of the three negative browser
  groups passes independently, and the complete serial browser matrix passes
  9 tests with 12 intentional focused-engine skips. The corrected dependency
  and configuration surface is included in targeted style, API, reliability,
  and documentation re-review.

### Slice E targeted re-review dispatch

- Existing style/maintainability, TypeScript/API, and performance/reliability
  reviewers are redispatched read-only with explicit
  `gpt-5.6-terra` / `high`; existing documentation is redispatched through its
  immutable `gpt-5.6-luna` / `medium` role with the already-recorded desktop
  override limitation.
- Re-review is limited to the consolidated corrections, clean-browser
  dependency/configuration fixes, exact focused/real evidence, and disposition
  of the original findings. No reviewer may edit, mutate Git, spawn children,
  inspect Slice F, or invoke any JVM-family operation.

### Slice E targeted style/API/reliability results

- Style/maintainability is CLEAN. The multiline Vite configuration resolves
  the original P2, and no new P0-P2 issue exists in the bounded correction.
- TypeScript/API is CLEAN. TypeDoc and all three public documentation surfaces
  state binary Connect `application/proto`, packed-`Any` gateway permission,
  and no probing/fallback. Direct Connect dependencies and the lockfile
  importer are correct; no new P0-P2 issue exists.
- Performance/reliability is CLEAN. One per-resource-bounded cleanup owner
  covers all acquired resources, startup failures, continued cleanup after
  rejection, and correct dependency order. Spawn errors reject, detach the
  competing listener, and reach topology `finally`. The five focused
  regressions and real evidence support both resolved findings; local tsconfig
  and `testMatch` isolate Playwright correctly.
- Runtime self-introspection is unavailable for all three results. Immutable
  configured existing profiles are respectively
  `style_maintainability_reviewer`,
  `typescript_api_docs_reviewer`, and
  `performance_reliability_reviewer`, each
  `gpt-5.6-terra` / `high`, with no visible mismatch or fallback.

### Slice E targeted documentation result

- Documentation is CLEAN. `interop/envoy/README.md` covers renderer inputs,
  six gateway routes, TLS and HTTP/2, pinned-image validation,
  application-owned lifecycle, customization, and the no-public-backend
  boundary, with accurate links from the user, client-web, and Chat guides.
  Binary Connect guidance states `application/proto`, packed `Any`, gateway
  permission, and no probe/fallback. Reports and clean-browser dependency
  wording are accurate; no new P0-P2 issue exists.
- Runtime self-introspection is unavailable. The immutable configured existing
  `documentation_reviewer` profile is `gpt-5.6-luna` / `medium`; no visible
  mismatch or fallback occurred. The recorded desktop override limitation
  remains honest.
- Slice E is review-converged across all four canonical concerns. Final
  deterministic verification, checkpoint commit, and immediate remote push
  follow before Slice F begins.

### Slice E final deterministic gate

- Vitest passes 14 files / 418 tests across auth, client-web, frozen fixture,
  and descriptor compatibility.
- Node passes 12/12 lifecycle, spawn-error, real topology, Envoy renderer, and
  static-wire tests. The immediately preceding complete browser matrix passes
  all three separated negative groups and 9 tests with 12 intentional
  focused-engine skips.
- Auth and client-web TypeScript builds pass. Generated TypeDoc and API
  inventory checks pass, including the unchanged 22-export client-web surface
  and 102-export auth surface. Package metadata passes 2/2; dependency
  isolation, formatting, and diff hygiene pass.
- Slice E is accepted for checkpoint commit and immediate task-branch push. No
  Spine JVM command, build, test, generation, dependency resolution, launch, or
  download was invoked.

## Slice F documentation implementation dispatch

- Slice F is high-risk release/documentation closure under the binding
  `F_TASK_BRIEF.md`. Runtime behavior in Slices A-E is frozen.
- One existing `implementer` is explicitly dispatched with expected/configured
  `gpt-5.6-terra` / `medium`. It owns the authoritative agent-oriented guide,
  directly related user/package/example/API documentation, necessary TSDoc,
  fresh-reader/snippet checks, focused tests, and evidence records.
- The owner must remove stale incremental claims, preserve every human
  decision and public limitation, use current compile-checked APIs, and provide
  responsibility/decision/configuration tables plus durable lifecycle,
  topology, and third-party authentication diagrams. It may not change runtime
  semantics, commit/push/merge, spawn children, or run any JVM-family
  operation.

## Slice F specialist review dispatch

- Independent mechanical verification is green for compile-checked TypeScript
  snippets, generated TypeDoc and exact public API inventory, documentation
  checks, client-web dependency isolation, checker ESLint, repository
  formatting, and diff hygiene.
- Existing `style_maintainability_reviewer`,
  `typescript_api_docs_reviewer`, and
  `performance_reliability_reviewer` are dispatched read-only with explicit
  expected/configured `gpt-5.6-terra` / `high`. The existing
  `documentation_reviewer` is dispatched through its immutable
  `gpt-5.6-luna` / `medium` profile; the execution surface does not permit a
  model override for that fixed role, which is recorded rather than
  misrepresented.
- Review scope is the Slice F authoritative guide, linked public documentation,
  compile-check inventory, two mechanical fixture-format corrections, and
  factual consistency with the frozen Wave 4 implementation. Reviewers may not
  edit, mutate Git, spawn children, inspect or execute Spine JVM-family work,
  or reopen accepted runtime design.

## Slice F specialist review results and correction dispatch

- Style/maintainability reports three P2 findings: executable snippets are not
  type-checked against real exported declarations, the `ResolveContext` matrix
  heading conflates valid-session authentication with per-request policy
  authorization, and most named extension seams lack exact signatures or
  direct declaration routes.
- TypeScript/API independently confirms the real-contract checking and exact
  declaration-route P2 findings. It otherwise confirms the public API claims
  and the corrected `ResolveContext` versus `IncomingRequest` distinction.
- Performance/reliability reports one P1: the primary cookie-session browser
  example omits `credentials: session.credentials`, so cross-origin RPC calls
  can omit the application cookie even though `BrowserSession.fetch()` is
  credentialed.
- Documentation reports one additional P2: the guide does not publish the
  implemented numeric Envoy, gateway-envelope, and subscription-relay defaults
  and failure boundaries required by the task brief. No other stale or
  contradictory guidance is confirmed.
- Runtime self-introspection is unavailable for all results. The immutable
  configured existing profiles are style, API, and reliability reviewers on
  `gpt-5.6-terra` / `high`, and documentation reviewer on
  `gpt-5.6-luna` / `medium`, with no visible mismatch or fallback.
- One deduplicated correction batch returns to the existing Slice F
  `implementer`, explicitly expected/configured `gpt-5.6-terra` / `medium`.
  It must add the cookie credential invariant, real public-contract snippet
  checking, accurate matrix semantics, exact extension declaration routes,
  and numeric limit/default/failure documentation with fail-closed checks. It
  may not redesign runtime behavior, commit/push/merge, spawn children, or
  perform any JVM-family operation.

## Slice F correction verification and targeted re-review dispatch

- The existing implementer completed the consolidated batch under explicit
  configured `gpt-5.6-terra` / `medium`; runtime self-introspection remains
  unavailable and no mismatch is visible.
- The browser cookie bootstrap supplies `credentials: session.credentials`;
  executable guide snippets resolve and type-check against actual workspace
  public declarations; pseudocode remains explicitly labelled; the operation
  matrix separates session validation from authorization; direct declaration
  routes/signatures cover all required seams; and implemented
  gateway/relay/Envoy limits and failure behavior are tabulated.
- Independent verification passes declaration-backed snippet checking,
  generated TypeDoc and exact API inventory, documentation checks, client-web
  dependency isolation, checker ESLint, repository formatting, and diff
  hygiene.
- Style, TypeScript/API, reliability, and documentation concerns reopen only
  for disposition of their accepted findings and regression inspection.
  Expected profiles remain the three applicable existing Terra reviewers on
  explicit `gpt-5.6-terra` / `high`, and the immutable documentation reviewer
  on `gpt-5.6-luna` / `medium`. Reviews are read-only and prohibit all
  JVM-family operations.

## Slice F first targeted re-review results

- Style confirms declaration-backed guide checking and the corrected
  `ResolveContext` matrix, but retains one P2 because
  `NativeGatewayRequestContext.credential()` and `.transport()` are prose-only
  rather than signature-checked.
- TypeScript/API confirms the same residual P2 and adds the related
  `transportFacts` request-fact constructor: all three routes require exact
  declaration-backed coverage. Other public API corrections are accepted.
- Reliability confirms the P1 cookie bootstrap and all published limits, but
  identifies one residual P2: `pendingOperationLimit` defaults to one, which
  permits one active plus one queued operation and rejects the third as
  `binding-busy`; the guide/checker omit it.
- The existing implementer receives this single narrow residual batch under
  explicit configured `gpt-5.6-terra` / `medium`. Runtime behavior remains
  frozen; no Git/JVM/child activity is permitted.

## Slice F residual verification and final targeted dispatch

- The existing implementer adds declaration-backed `typeof transportFacts`,
  `NativeGatewayRequestContext["credential"]`, and
  `NativeGatewayRequestContext["transport"]` routes, plus the
  `pendingOperationLimit = 1` rule: one active and one queued operation are
  allowed, while the third rejects as `binding-busy`.
- Independent declaration-snippet, generated TypeDoc/API, documentation,
  ESLint, formatting, and diff checks pass.
- Style/API reopen only exact route coverage; reliability/documentation reopen
  only the pending-operation and limits-table correction. Existing profiles
  remain explicit Terra High for style/API/reliability and immutable Luna
  Medium for documentation. All reviews are read-only with no JVM activity.

## Slice F specialist convergence and final security dispatch

- Style/maintainability is CLEAN. The guide declaration-checks
  `typeof transportFacts`, `NativeGatewayRequestContext["credential"]`, and
  `["transport"]`; the checker requires the exact routes.
- TypeScript/API is CLEAN. All accepted exact-signature and public-contract
  findings are resolved, with declaration-backed snippets passing.
- Performance/reliability is CLEAN. The credential bootstrap and all finite
  limits are accurate, including one active plus one queued operation and a
  third `binding-busy` rejection.
- Documentation is CLEAN. The authoritative guide covers current exported
  declaration routes and every required Envoy, gateway, binding, relay,
  operation, and shutdown default/failure boundary without stale Wave 4
  claims.
- Runtime self-introspection is unavailable for the targeted confirmations.
  Immutable configured profiles remain the three relevant Terra High reviewers
  and the Luna Medium documentation reviewer, with no visible mismatch.
- Slice F is specialist-converged. The existing final `security_reviewer` is
  dispatched once across the complete Wave 4 diff from `f8a59883`, with
  explicit expected/configured `gpt-5.6-terra` / `high`. Scope covers
  authentication/session/provider flows, cookies/CSRF/CORS, context rewriting,
  request facts, native forwarding, subscription ownership and relays,
  redaction, finite limits, Envoy/trust topology, browser lifecycle, examples,
  tests, and public limitations. The review is read-only and prohibits all
  Spine JVM-family operations.

## Wave 4 final security result

- Final security is CLEAN with no confirmed P0-P2 security or correctness
  finding across the complete diff from `f8a59883`: authentication, opaque and
  signed sessions, OIDC/provider flows, cookie/CSRF/CORS boundaries, trusted
  context rewriting, request facts, native forwarding, subscription
  ownership/private envelopes/relay limits, browser and Chat behavior, Envoy,
  dependencies, diagnostics, tests, and public limitations.
- `interop/envoy/validated.yaml` is a stale, unreferenced syntax-validation
  fixture without the renderer's credentialed-CORS fields. It is not an active
  browser topology or public deployment input; both use `renderEnvoy()`, which
  includes credentialed CORS and `x-spine-csrf`. This is accepted as
  non-release-blocking and is not represented as the deployable template.
- Newly locked Vite `8.1.0` is outside the affected `<=8.0.4` advisory range,
  and `protobufjs 7.6.5` is outside the affected `<7.5.5` range.
- Runtime self-introspection is unavailable. The immutable configured existing
  security profile is explicitly `gpt-5.6-terra` / `high`, with no visible
  mismatch or fallback. No Spine JVM-family work was inspected or executed.
- Full native repository verification and coverage now form the final task
  acceptance gate.

## Full-verification correction dispatch

- Final `verify` exposes a deterministic tooling-typecheck gap: 143 strict
  errors across 16 Wave 4 test/example files. Root-cause triage identifies
  inferred mutable fixtures, widened iterator discriminants, intentional
  invalid-input boundaries, generated-message presence/optional handling, and
  a Chat application/core `UserId` schema mix-up.
- One existing implementer is dispatched with explicit
  `gpt-5.6-terra` / `medium` and exclusive ownership of the failing
  tests/fixtures. Production contracts remain frozen; corrections must be
  source-rooted and preserve behavioral assertions.
- After deterministic convergence, style/API/reliability reopen only affected
  test-helper and browser-fixture concerns. Security reopens only if a change
  affects executable browser/auth boundary behavior.

## Full-verification lint correction dispatch

- Tooling typecheck is independently green and listener-dependent focused tests
  pass 49/49 with localhost permission. The supported lint gate now reports
  703 Wave 4 errors: 76 environment-global configuration gaps and 627
  strict-rule code/test violations.
- The existing implementer remains the single writer under explicit
  `gpt-5.6-terra` / `medium`. Strict rules and public/runtime contracts remain
  in force. Accurate path-scoped globals are configuration correctness, while
  all other findings require semantics-preserving source/test correction.
- Style and TypeScript/API necessarily reopen for the lint correction;
  reliability/security reopen only for substantively affected production or
  executable browser/auth behavior.

### Auth-production lint ownership transfer

- OIDC and native auth production sources are lint-clean with tooling
  typecheck green. The initial correction context returns the same 33
  provider/signed-session/subscription findings across three bounded turns.
- A replacement existing `implementer`, explicitly
  `gpt-5.6-terra` / `medium`, receives exclusive ownership of those three
  files. It must preserve the established public contracts and runtime
  validation/lifecycle semantics and may not weaken rules or perform Git,
  child, or JVM-family work.

## Final verification-correction review wave

- Style/maintainability reports one P1 and two P2 findings. The P1 identifies
  lint-only `await Promise.resolve()` statements in the native relay that defer
  formerly immediate push/close effects and introduce observable races. The
  P2 findings identify two client cancellation tests that stopped proving abort
  reason identity.
- TypeScript/API reports one P2: `SignedSessions.issue()` may now throw
  synchronously even though its public contract returns a Promise.
- Performance/reliability reports one P1 and one P2. Accessor-backed OIDC input
  can return different grant identifiers across validation/lookup/deletion and
  leave the issued grant replayable. An opaque-session principal getter can
  close the store during copying after the final terminal check, allowing a
  record to be inserted into a closed store.
- All six findings are accepted as one correction batch. The configured
  existing reviewer profiles were explicitly `gpt-5.6-terra` / `high`;
  runtime self-introspection was unavailable with no visible mismatch. No
  reviewer changed files or performed a Spine JVM-family operation.
- Correction re-review is clean for style/maintainability and confirms the
  native immediate-effect and abort-reason fixes. TypeScript/API and
  reliability independently report the same remaining P2: hostile Proxy shape
  inspection can throw outside the OIDC snapshot catch boundary, violating the
  rejection-union contract. The accepted correction also covers analogous
  start/callback runtime validation paths; all prior findings are otherwise
  resolved.
- Final OIDC API and reliability re-review independently find the same P1:
  snapshotting grant and verifier together lets a throwing verifier getter
  reject before a known grant is deleted. The initial regression is a false
  positive because its issuer rejects even if the grant survives. The accepted
  correction must snapshot/validate the grant first, delete a known grant, then
  snapshot/validate the verifier separately, and prove non-replay with a
  successful issuer.
- The split-snapshot correction is independently verified and both final API
  and reliability re-reviews are CLEAN. A known grant is deleted synchronously
  before verifier snapshot/validation, hostile access maps to the rejection
  union, and the successful-issuer regression proves no replay. All targeted
  correction findings are closed.
- The existing final `security_reviewer` is dispatched once more across the
  complete release-ready Wave 4 diff, explicitly expected/configured
  `gpt-5.6-terra` / `high`, with no JVM-family operation authorized.
- Final security is CLEAN across the complete release-ready Wave 4 diff with
  no confirmed P0-P2 issue. Grant burn ordering, cookie Origin/CSRF controls,
  credential stripping, private bounded relays, logging, browser behavior, and
  Envoy trust assumptions are accepted. Operator-supplied Envoy topology
  remains trusted configuration, and the unreferenced validation fixture
  remains non-blocking. Runtime self-introspection is unavailable; the
  immutable configured profile is `gpt-5.6-terra` / `high`.
- The first full native verification run exposes one BlackBox cancellation
  regression from lint-time bound method capture. The dynamic-lookup closure
  correction passes focused and mechanical gates. Targeted style and
  reliability re-reviews are both CLEAN: cancellation remains observable,
  precedes iterator disposal, and releases ownership idempotently without a
  new race or retention path. API/documentation/security remain N/A for this
  internal lifecycle-only correction.
- Final coverage test review accepts the behavioral branch gain but reports two
  P2 assertion gaps: the Node factory test must prove the exact owned session
  manager is passed into transport construction, and opaque fail-closed tests
  must prove pre-existing credentials are cleared and cannot resolve or rotate.
  Both are accepted as one test-only correction batch; production and public
  behavior remain frozen.
- The Node exact-manager assertion is accepted. The initial overflow cleanup
  assertion expired its seed during pre-sweep; reviewers correctly reject that
  false positive. Moving the trigger one millisecond earlier keeps the seed
  live until overflow-driven `failClosed()`. Final style and reliability
  re-reviews are CLEAN: both opaque paths prove live-state clearing and
  terminal resolve/rotate/create behavior, and Node ownership tests are exact,
  deterministic, and network-free.
- Final commit-ready native verification is GREEN: 157 test files pass with 3
  skipped; 3,070 tests pass with 25 skipped; branch coverage is 90.01%
  (10,061/11,177). Typecheck, lint, cleanup, formatting, TypeDoc/API checks,
  Protobuf integrity/generated-clean, and release-readiness all pass. All
  review concerns are closed.
- Task endpoint `470cd41f` is merged without conflict as `77105890`. Full
  post-merge verification is GREEN with the same 157 files / 3,070 runnable
  tests / 90.01% branch coverage, plus clean docs, Protobuf, generated-output,
  and release-readiness gates. `origin/main` contains `77105890`.
