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
