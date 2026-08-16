# T-0198 — ZeroMQ message-channel adapter

- Role: existing implementer, explicitly gpt-5.6-terra / medium.
- Child spawning: prohibited. Runtime telemetry: unavailable.
- Scope: distinct Wave 13 typed-message ZeroMQ TransportFactory adapter only; SignalTransport remains untouched.

## Secure manifest lifecycle checkpoint

- The adapter now writes an atomic, mode-0600 v1 manifest only after its PULL
  socket binds, refreshes its heartbeat on an unref 1000ms timer, and removes
  the manifest before closing the socket. Scanner behavior is bounded to 1024
  lexical manifest entries and 4096 bytes per manifest; malformed, symlinked,
  dead-owner, stale, and missing-socket own-identity entries are removed.
  Valid foreign identities are ignored without deletion.
- The private layout remains `<ipcDirectory>/spine-message-channels`; socket
  paths are rejected before bind when they exceed the native IPC pathname
  limit. Native success fixtures deliberately use `/tmp/sz-*`, while a focused
  test proves the long-root rejection. This is a fixture correction required by
  the frozen path guard, not a public configuration or endpoint-layout change.
- Evidence: `pnpm typecheck:build:generated` passed; focused native manifest
  tests plus shared RED-21 passed 4/4 on 2026-08-16. Focused ESLint passed for
  the adapter and new native test. Shared conformance retains pre-existing
  lint debt outside this checkpoint's behavior work.
- Native publishers now serialize accepted work through one promise tail,
  snapshot/validate the supplied wrapper identity and message before I/O, and
  return one close completion after draining. Accepted failures remain
  observable as an AggregateError at close. PUSH sockets are cached per live
  subscriber generation and evicted on manifest reconciliation.
- Cache entries retain both generation and endpoint, so endpoint replacement
  closes and replaces the old PUSH socket. Subscriber run/heartbeat failures
  are retained and made observable through close; publisher and factory close
  calls share their in-flight completion. The focused suite now proves these
  close races in addition to FIFO/identity behavior (6/6 tests with shared
  RED-21). Independent publisher fan-out now has native proof. Outstanding
  before task completion: injected background-failure proof and final
  lifecycle review.
- Failed atomic manifest writes now remove their same-directory exclusive temp
  file before returning the original failure. Fresh generated typecheck,
  focused lint, and native plus shared transport tests passed 7/7.

## Consolidated review correction batch

- Review assignments: TypeScript/API reviewer `gpt-5.6-terra` / high and
  performance/reliability reviewer `gpt-5.6-terra` / high. The implementation
  owner remains `gpt-5.6-terra` / medium; child spawning is prohibited and
  runtime telemetry is unavailable.
- Corrected lifecycle behavior: the last consumer handle closes/withdraws its
  subscriber; factory close observes in-progress subscriber opens; subscriber
  close drains receive work; and the scanner bounds all lexical entries before
  filtering manifests. These changes are green in the focused suite (7/7).
- Remaining batch items: deterministic injected proofs, shared IPC helper
  extraction, bounded failure samples, startup sweep, and final API-doc check.

## Ownership transfer — 2026-08-16

- The original implementer context exhausted its turn budget after pushed head
  `c9abfe5f`. The replacement is the existing `implementer` role, assigned the
  bounded consolidated-review remainder on `wave13-t0198-zeromq`.
- Dispatch profile: explicitly configured `gpt-5.6-terra` / `medium`.
  Runtime telemetry is unavailable; the immutable configured role/profile is
  the available evidence.
- Acceptance work: remove the MessageTransport-to-SignalTransport dependency
  by extracting the intact private IPC preparation seam, add deterministic
  lifecycle/failure regression proofs, and record their focused validation and
  reviewer dispositions here before the next review boundary.

## Correction evidence — 2026-08-16

- Accepted dependency-boundary finding: resolved by package-local
  `channel-endpoints.ts`; MessageTransport imports that helper directly, while
  SignalTransport retains its native/test seam as a delegating compatibility
  path. No public export, configuration, or endpoint layout changed.
- Lifecycle evidence added: final consumer closure removes its manifest and
  socket; factory close drains a gated pending subscriber open and leaves no
  socket entry; subscriber close waits for accepted consumer delivery and
  exposes that consumer failure. Focused native plus shared transport tests
  passed 74 tests, and generated typecheck passed.
- TypeScript/API reviewer disposition: accepted boundary correction is
  implemented: both adapters now delegate secure IPC preparation to the one
  package-local helper, with no MessageTransport import of SignalTransport.
  No public configuration or export changed.
- Performance/reliability reviewer disposition: accepted. Deterministic tests
  now prove the heartbeat close fence, attempt-all cleanup following injected
  manifest removal failure, final-consumer withdrawal, factory-close/open
  racing, subscriber delivery draining, and bounded total lexical scanning.
- SPI rejection disposition: accepted. Invalid and closed `createPublisher`
  and closed `addConsumer` calls are proved to return rejected promises rather
  than throwing synchronously. Existing startup sweep and bounded manifest
  failure tests remain covered by the preceding pushed checkpoint.
- Final local evidence: generated typecheck passed; focused manifest,
  SignalTransport, and shared message conformance tests passed 78 tests;
  focused ESLint, Prettier, diff, `docs:api:generated`, and `docs:api:check`
  are recorded as the final correction preflight. No accepted finding remains
  open in this implementation slice.
