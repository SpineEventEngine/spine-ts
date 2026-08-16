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
