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
- The focused suite now proves concurrent per-publisher FIFO plus mismatched
  identity rejection (5/5 tests with shared RED-21). Outstanding before task
  completion: dedicated multipublisher/close-race/background-failure proofs,
  cache identity endpoint replacement, and final lifecycle review.
