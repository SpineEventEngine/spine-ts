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
