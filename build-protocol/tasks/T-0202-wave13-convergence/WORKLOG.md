# T-0202 Work Log

## Start — 2026-08-16

- Fresh `origin/main` is
  `c9082938f12b33eb75eb666d935e13b164bd66fe`; the convergence branch is
  isolated at `wave13-t0202-convergence`.
- T-0200 retained canonical task verification with 157 focused tests and exact
  changed executable coverage of 95.04% lines / 90.12% branches. T-0201
  retained native acceptance, 10 consecutive reliability-review passes, and
  clean post-merge generated/native regression evidence.
- Dispatched the existing documentation reviewer function with explicit
  `gpt-5.6-luna` / `medium` configuration, no subagent authority, and
  unavailable runtime telemetry. It owns a read-only current-truth audit; the
  orchestrator owns all documentation edits.

## Documentation audit and ownership — 2026-08-16

- The read-only audit found documentation/status/inventory drift but no new
  product-contract inconsistency. Highest-priority contradictions are the old
  `@External()` claim, “external origin not implemented” claims, obsolete
  broker durability requirements, registry-v2/no-origin API prose, and stale
  Wave 13 planning/completion status.
- Two independent documentation implementation functions are dispatched with
  explicit `gpt-5.6-luna` / `medium` profiles, no subagent authority, and
  unavailable runtime telemetry. One owns package/user guidance; one owns
  architecture/API guidance. They must not edit canonical protocol records or
  each other's files.
- The orchestrator owns `DEVELOPER_API`, `RUNTIME_ARCHITECTURE`,
  `TECHNICAL_SPEC`, completion/remediation/Wave 13 status, API-inventory
  enforcement, final evidence, and integration.

## Documentation convergence — 2026-08-16

- Package, user, architecture, API, and canonical protocol/status documents now
  describe the complete application schema universe, context-owned three-exchange
  broker, generated `External<T>` origin metadata, tenant/loop boundaries,
  ThirdParty import, corrupt-event log/drop continuation, exact wire provenance,
  distinct SignalTransport/message-channel responsibilities, adapter-private
  manifests, best-effort delivery, and real two-process proof.
- Reconciled the older remediation plan: P-01 is resolved by Wave 13 and the
  earlier broker Inbox/retry/dedup/restart requirements are superseded by the
  binding transport-owned reliability placement. T-0195 through T-0201 status
  is recorded; T-0202 remains current rather than prematurely complete.
- Strengthened API inventory enforcement. TypeDoc verifies the existing curated
  Proto surface, exact server/transport/ZeroMQ roots, and the script separately
  verifies all 17 generated integration Proto declarations plus their exact
  root re-export paths. The current check passes with 100 curated Proto,
  17 integration Proto, 255 server, 25 transport, and 6 ZeroMQ exports.
- Generated build passes. TSDoc, documentation audience, 394 Markdown links,
  cleanup, copyright, scoped ESLint/Prettier, and diff checks pass. The
  authoritative current-doc stale-claim scan is clean; matches in historical
  task evidence are intentionally retained as history.
- Both documentation implementation functions used explicit
  `gpt-5.6-luna` / `medium` profiles, no subagents, and unavailable runtime
  telemetry. Their disjoint file ownership is complete and returned to the
  orchestrator.

## Final specialist review wave — 2026-08-16

- The complete read-only review wave used the existing project roles with no
  subagent authority and unavailable runtime telemetry: style/maintainability,
  performance/reliability, and TypeScript/API reviewers were explicitly
  configured `gpt-5.6-terra` / `high`; the documentation reviewer was
  explicitly configured `gpt-5.6-luna` / `medium`; the final security reviewer
  was explicitly configured `gpt-5.6-terra` / `high`.
- Accepted product findings: native receive errors must be contained per frame
  so one malformed or rejected frame cannot stop a channel; failed subscriber
  manifest cleanup must remain retryable and owned; native frames need one
  adapter-private total-size bound before Protobuf decoding; status/config
  intake must validate wrapper identity and online source consistency; manifest
  reads must verify the opened file's identity, owner, mode, and non-symlink
  status rather than trust an `lstat`/path-open race.
- The frame bound is an adapter-private Node/ZeroMQ resource-safety mechanism,
  not a broker policy, public setting, wire field, or nested payload protocol.
  It preserves the exact Protobuf contract and is documented as a transport
  limit. No broker retry, replay, acknowledgement, or persistence is added.
- Accepted documentation findings: correct incoming EventBus schema versus
  outgoing ThirdParty application-registry ownership; correct the root versus
  internal generated-registry export boundary; supply the application registry
  prerequisite in the ThirdParty example; resolve the stale P-04 external-origin
  sub-disposition; describe ThirdParty input as a registered generated message
  used as an event payload. A stricter descriptor-level event designation is
  rejected because pinned JVM accepts `Message` and Wave 13 must not invent a
  new admission policy.
- One consolidated correction owner is dispatched as the existing implementer,
  explicitly configured `gpt-5.6-terra` / `medium`, with no subagent authority
  and unavailable runtime telemetry. It owns the transport/broker source and
  focused tests, the accepted documentation corrections, and this task's
  correction evidence until handoff.

## Final review correction batch — 2026-08-16

- RED was retained for native consumer-rejection continuation and retryable
  subscriber manifest cleanup. The original focused run failed respectively by
  timing out before a later valid frame and by returning the cached failed close
  attempt. GREEN contains per-frame raw decode containment, bounded retained
  consumer failure reporting at close, a retryable cleanup attempt while
  admission remains closed, and a factory that permanently rejects creation
  while permitting a later cleanup attempt.
- The native adapter now applies one private 1 MiB bound to the complete
  encoded `ExternalMessage` before local send and before decode. The bound is
  also passed to ZeroMQ socket options. It covers nested payload bytes and adds
  no public setting, protocol field, or broker policy. Raw malformed and
  oversized frames drop without poisoning close; consumer failures are bounded
  close evidence and do not stop later frame delivery.
- Manifest discovery opens with `O_NOFOLLOW`, compares pre-open `lstat` and
  opened-handle identity/type/size, and requires effective-user ownership with
  exact `0600` permissions for local entries. Foreign adapter manifests remain
  untouched. Focused coverage includes an invalid-mode manifest.
- Control intake now requires a non-empty `StringValue` UUID wrapper identity;
  online payload context must agree with wrapper origin before normal
  self/paired filtering. Focused tests prove forged identity and mismatched
  origin reject while a later valid peer remains accepted.
- Documentation now distinguishes destination EventBus schemas for incoming
  event decode from the complete ServerEnvironment application registry used by
  ThirdParty outgoing encoding; records the ThirdParty prerequisite and the
  generated-registry root/internal boundary; resolves P-04's stale external
  origin wording; and documents the native frame and continuation semantics.
- GREEN evidence: `pnpm exec vitest run
packages/transport/test/zeromq/message-transport-manifest.test.ts
packages/server/test/integration/integration-broker-module.test.ts` passed
  2 files / 51 tests. `pnpm typecheck:build:generated` passed. `pnpm exec
vitest run packages/server/test/server/server-integration-broker-cross-process.test.ts`
  passed 1 file / 1 real two-process normal-application-flow test. Scoped ESLint,
  Prettier check, and `git diff --check` passed. The failed `pnpm run
build:generated` invocation was a non-mutating incorrect script-name lookup;
  the required generated build was then run with its actual repository command.

## Residual re-review correction batch — 2026-08-16

- Security P2: stable invalid manifests remain removable, but manifest cleanup
  now re-establishes pathname identity immediately before unlinking. An
  `lstat`/opened-handle identity mismatch is ignored rather than deleted, so a
  concurrent atomic replacement remains owned by its writer. A deterministic
  private open seam replaces a manifest between inspection and open; the fresh
  valid replacement survives and is discovered for delivery.
- Reliability P1: the RED-21 same-identity incompatible native peer manifest is
  now written with exact `0600` mode. It therefore reaches native discovery
  under the accepted manifest policy, while healthy delivery and aggregate
  failure evidence remain part of the same conformance contract.
- Factory cleanup regression: the existing unlink injection now directly proves
  first `factory.close()` rejection, a successful second close, permanent
  creation rejection, and absent manifest/socket after retry.
- RED/GREEN: the replacement race test first timed out because the former code
  unlinked the fresh pathname after identity mismatch. After conditional
  removal, `pnpm exec vitest run
packages/transport/test/zeromq/message-transport-manifest.test.ts
packages/transport/test/message-transport-conformance.test.ts` passed 2
  files / 20 tests.
- Final residual evidence: `pnpm typecheck:build:generated` passed, and
  `pnpm exec vitest run packages/transport/test/zeromq/message-transport-manifest.test.ts
packages/transport/test/message-transport-conformance.test.ts
packages/server/test/integration/integration-broker-module.test.ts
packages/server/test/server/server-integration-broker-cross-process.test.ts`
  passed 4 files / 54 tests. Scoped ESLint, Prettier, and `git diff --check`
  passed before handoff.

## Final security residual — 2026-08-16

- Security re-review found the prior identity recheck still left a pathname
  `lstat`/`rm` gap, including stale-entry pruning. Cleanup now atomically moves
  the pathname to a unique same-directory quarantine first, then compares the
  quarantined inode with the inspected inode. A match deletes only quarantine.
  A mismatch is restored with an exclusive hard link when no newer pathname
  exists; if one does, that newer entry remains authoritative and quarantine is
  removed. Stale socket removal occurs only after the inspected stale manifest
  was actually quarantined and deleted.
- Deterministic private move seams cover a replacement after invalid-manifest
  inspection and a replacement after `isLive()` declares a manifest stale. In
  both cases, the fresh valid manifest survives, remains discoverable, and the
  next normal publication reaches its subscriber.
- GREEN evidence: `pnpm typecheck:build:generated` passed. `pnpm exec vitest
run packages/transport/test/zeromq/message-transport-manifest.test.ts
packages/transport/test/message-transport-conformance.test.ts
packages/server/test/server/server-integration-broker-cross-process.test.ts`
  passed 3 files / 23 tests. Scoped ESLint, Prettier, and `git diff --check`
  passed before push.

## Final stale-socket residual — 2026-08-16

- Security re-review found that stale cleanup still unconditionally removed a
  socket after manifest quarantine. Liveness inspection now retains whether a
  stale owner is positively absent (`ESRCH`). Only that confirmed-dead case
  removes the existing v1 owner socket. A live or `EPERM`/potentially-live
  owner with an expired heartbeat loses only the old manifest, preserving its
  socket so the next heartbeat can advertise a fresh manifest. A missing or
  non-socket endpoint likewise needs only manifest cleanup.
- Deterministic coverage writes a fresh manifest after matched stale quarantine
  and before the former socket-removal point; its live socket remains and a
  normal subsequent publication delivers. A separate dead-owner fixture binds
  a real IPC socket and proves both stale manifest and socket are removed.
- Final residual evidence: `pnpm typecheck:build:generated` passed. `pnpm exec
vitest run packages/transport/test/zeromq/message-transport-manifest.test.ts
packages/transport/test/message-transport-conformance.test.ts
packages/server/test/server/server-integration-broker-cross-process.test.ts`
  passed 3 files / 25 tests. Scoped ESLint, Prettier, and `git diff --check`
  passed before push.

## Cleanup necessity ledger reconciliation — 2026-08-16

- Deterministic preflight reported only stale standalone-function necessity
  records after the final security corrections. Removed the obsolete
  `isLive()#1` identity; recorded exact responsibility-specific necessities for
  `inspectLiveness()#1`, `quarantineIfUnchanged()#1`, and
  `restoreQuarantine()#1` in the transport partition, and
  `isControlIdentity()#1` in the server partition. No product code, public
  API, or broad exemption changed.
- `pnpm lint:cleanup`, focused Prettier, and `git diff --check` pass.

## TSDoc preflight reconciliation — 2026-08-16

- Deterministic preflight reported incomplete TSDoc only on the two private
  `zeroMqMessageAccess` test-seam callables. Their blocks now use the project
  opener and blank-line form with callable summaries, exact parameters, and
  return descriptions. No runtime behavior changed.
- `pnpm lint:tsdoc`, focused Prettier, and `git diff --check` pass.

## Coverage correction regressions — 2026-08-16

- Exact Wave 13 diff coverage preflight reported 79/91 changed lines (86.81%)
  and 52/67 changed branches (77.61%). The gap was addressed with behavioral
  regressions rather than coverage-only assertions: undecodable packed control
  UUID then valid peer processing; oversized raw native frame then valid
  delivery; exact-0600 structurally invalid manifest removal; injected
  quarantine move failure with no artifact leak and later delivery; non-socket
  endpoint preservation; and `EPERM` stale/fresh owner re-advertisement.
- Focused regression evidence: `pnpm exec vitest run
packages/transport/test/zeromq/message-transport-manifest.test.ts
packages/server/test/integration/integration-broker-module.test.ts` passed
  2 files / 58 tests. Scoped ESLint, Prettier, and `git diff --check` pass.

## Test-only type preflight reconciliation — 2026-08-16

- Preflight correctly rejected constructing an intentionally structurally
  invalid manifest through the typed production test seam. The fixture now uses
  raw filesystem JSON plus exact `0600` permissions, preserving the same
  invalid-schema behavior without an unsafe cast or production seam widening.

## Final changed-branch proofs — 2026-08-16

- Fresh exact intersection was 87/91 lines (95.60%) and 58/67 branches
  (86.57%). Added three concrete existing-path proofs: an online frame missing
  its own `message.id` rejects despite a separate valid publisher identity;
  a subscriber with an active consumer is not stale before its handle closes;
  and a quarantine mismatch whose restoration sees a newer canonical manifest
  preserves that newest manifest, valid delivery, and no quarantine artifact.
- `pnpm typecheck:tooling` and focused manifest/conformance/broker tests passed
  3 files / 61 tests; scoped ESLint, Prettier, and `git diff --check` pass.

## Release snippet preflight reconciliation — 2026-08-16

- Release verification failed only in new TypeScript documentation snippets.
  The external-receptor and ThirdParty examples now declare the real Message
  Board application snippet path and generated model import; the server example
  declares the Todo path and its real generated TaskCreated import. The fences
  remain checked TypeScript and no diagnostic suppression was added.
- `pnpm docs:snippets:check:generated` and `pnpm docs:audience:check` pass;
  focused Prettier and `git diff --check` pass. The attempted
  `pnpm docs:audience` name was non-mutating and corrected to the repository's
  actual `docs:audience:check` script.

## Release-suite test-contract reconciliation — 2026-08-16

- After the snippet correction, the complete release profile passed every
  deterministic generation, build, lint, documentation, API, Buf, and release
  readiness gate. Its full V8 run then retained a reproducible RED result: 65
  failures across seven test files, with 4,203 tests passing and 19 skipped.
- Stack traces and comparison with the accepted Wave 13 contracts isolate four
  stale fixture classes: generated-handler expectations missing the required
  domestic origin, Production environment fixtures missing explicit message
  transport/type-registry settings, single-tenant repository fixtures carrying
  tenant IDs, and the server root-export inventory missing
  `ThirdPartyContext`. These are test-contract reconciliation failures; no
  production behavior is being weakened to satisfy them.
- Three independent test-only correction lanes are dispatched from this exact
  checkpoint. The analyzer/export lane, server lifecycle/environment lane, and
  repository tenant lane each use the existing implementer role, explicitly
  configured `gpt-5.6-terra` / `medium`, without subagent authority. Runtime
  telemetry is unavailable; the immutable configured role/profile is the
  acceptance record. Each lane owns only its named test files in an isolated
  worktree and must retain focused RED/GREEN evidence before its pushed
  checkpoint is integrated here.
- The analyzer/export lane corrected the 10 exact version-3 analyzer
  expectations and the root export inventory; its focused two-file suite
  passed 43/43 tests. The lifecycle/environment lane corrected the one shared
  version-3 registry fixture plus explicit Production message transport and
  complete schema lookup settings; its four-file suite passed 192/192 tests.
- The repository lane confirmed that four source-origin tests intentionally
  carry and assert tenant IDs, so their contexts are multitenant. Parent
  verification then exposed one multitenant event/state reader without an
  explicit tenant selection; the retained RED failed with
  `Multitenant EventStore reads require a complete tenant ID.` The reader now
  selects the asserted `tenant-b` boundary using the established storage API.
- The converged exact release-failure matrix passes 7 files / 480 tests. All
  corrections are test-only; production tenant admission, handler-origin
  validation, Production configuration, and public exports remain unchanged.
- The first complete post-correction preflight passed every deterministic gate
  and 541/542 tests, but the real two-process proof timed out while running
  concurrently with ten heavy suites. It immediately passed alone in 635 ms.
  Root-cause tracing found that its one-shot readiness Event could be posted
  before asynchronous status/wanted discovery reached the producer, where the
  broker correctly treats it as not yet requested.
- The child-process harness now retries only that normal application Event
  until the external consumer observes it, then identifies the actual target
  Event and handler call by ID and payload rather than arrival position. It
  neither publishes a transport frame directly nor adds a sleep assumption.
  Standalone native acceptance passes, and the formerly failing concurrent
  11-file matrix passes 542/542 tests.

## Converged release evidence — 2026-08-16

- The final cheap preflight passed every deterministic generation, build,
  tooling, lint, formatting, documentation, API, Buf, generated-cleanliness,
  logging, and release-readiness gate. Its non-live focused matrix passed 10
  files / 541 tests; the separately serialized real two-process acceptance
  passed 1/1 in 635 ms with clean child and IPC-resource shutdown.
- `pnpm verify:release` passed on `aab395e8`: 266 test files passed and 4 were
  skipped; 4,268 tests passed and 19 were skipped. Repository-wide V8 coverage
  is 95.20% lines and 90.30% branches. The retained exact changed-production
  intersection remains 87/91 executable lines (95.60%) and 61/67 branches
  (91.04%); subsequent changes are documentation or test-harness-only.
- All five final concern dispositions are PASS: style/maintainability,
  performance/reliability, TypeScript/API, documentation, and security. No
  public, serialized, conceptual, or accepted residual remains.
