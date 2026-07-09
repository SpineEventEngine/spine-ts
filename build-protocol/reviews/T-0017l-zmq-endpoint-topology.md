# T-0017l Review Log

Status: clean after focused final re-review

Scope: ZeroMQ local IPC endpoint topology and worker execution behind
`SignalTransport`, docs/API updates, and native verification evidence.

## Required Lanes

| Lane                       | Reviewer ID                            | Status | Result          |
| -------------------------- | -------------------------------------- | ------ | --------------- |
| Code style/maintainability | `019f46a1-6a52-7011-ae49-5027dd02377e` | Closed | Findings to fix |
| Documentation completeness | `019f46a1-8895-7401-8be1-c4e80c55e9c6` | Closed | Findings to fix |
| TypeScript/API docs        | `019f46a1-a6c6-75b0-8e2f-054a8ef5f947` | Closed | Clean           |
| Security                   | `019f46a1-c14f-77b0-a94d-6e2ef077f637` | Closed | Findings to fix |
| Performance/reliability    | `019f46a1-e983-7d71-af7f-ed911a66f9ba` | Closed | Findings to fix |

## Review Requirements

- Reviewers must check the task `Human-Imposed Requirements Ledger`.
- Reviewers must check that public APIs remain transport-neutral or
  deliberately adapter-scoped.
- Reviewers must check that ZeroMQ endpoint strings, socket classes, multipart
  frames, and native module types do not leak into end-user framework APIs.
- Reviewers must check worker lifecycle, close ordering, and local IPC cleanup.
- Reviewers must check that native/local IPC verification evidence is present.
- Reviewers must check docs keep broader production supervision, retry, and
  multi-host transport deferred.

## Initial Findings To Inspect

- Existing transport root exports are adapter-neutral `SignalTransport`
  contracts.
- Existing ZeroMQ code only normalizes local IPC config and has
  adapter-private smoke tests for publish/subscribe and request/reply.
- T-0017l should connect those pieces without replacing the abstraction or
  introducing broad process supervision.

## Implementation Notes For Reviewers

- The root `@spine-ts/transport` export remains adapter-neutral.
- ZeroMQ construction is exposed only through the adapter-scoped
  `@spine-ts/transport/zeromq` subpath.
- The implementation derives local IPC endpoints internally from
  `ZeroMqAdapterConfig`, the operation channel, and `TransportTopic` routing
  descriptors. Endpoint strings, socket classes, multipart frames, and native
  module types are not part of server/framework APIs.
- Native IPC verification passed for the focused transport contract tests and a
  `RuntimeTransportBinding` command/event callback test. Sandboxed runs failed
  on the expected `ipc://` bind `Operation not permitted` limitation.
- Reviewer sub-agents have not run in this implementation turn because the
  task handoff explicitly instructed this implementation sub-agent not to spawn
  sub-agents.

## Round One Findings

- Documentation reviewer found stale deferred wording in `docs/USER_GUIDE.md`
  and `docs/architecture/README.md` that still implied local ZeroMQ endpoint
  topology was missing. The deferred wording must narrow to remote/multi-host
  topology, broker topology, process supervision, retries, and related
  production concerns.
- Style and reliability reviewers found that `subscribe()` implicitly bound a
  publisher endpoint through `#publisherFor()`, causing surprising endpoint
  ownership and cross-transport collisions. The bind ownership must stay on the
  publish side.
- Reliability reviewer found first publisher bind races on concurrent use.
- Style and reliability reviewers found subscriber handler/decode failures were
  swallowed silently.
- Reliability reviewer found the detached replier loop could die or produce an
  unhandled rejection if sending a failure response also failed.
- Security reviewer found the V8 `deserialize()` trust boundary was not
  documented/enforced enough and that handler error messages were returned to
  requesters without sanitization.

## Round One Fixes

- `docs/USER_GUIDE.md`, `docs/architecture/README.md`, and
  `packages/transport/README.md` now describe local ZeroMQ IPC endpoint
  topology as implemented and narrow deferred work to remote/multi-host
  topology, broker topology, process supervision, retry workers, health checks,
  and related production concerns.
- The ZeroMQ docs now state that the adapter uses Node's V8 serializer for
  trusted same-host runtime peers only and that `ipcDirectory` must be private
  to those peers.
- `subscribe()` now creates/uses only the IPC directory and connects a
  subscriber socket to the publish endpoint. It no longer calls
  `#publisherFor()` or binds the publish endpoint.
- First publisher creation now uses a per-routing-key in-flight bind promise so
  concurrent first `publish()` calls share one bind attempt.
- Subscriber loop failures now ignore only expected close/timeout receive
  errors; unexpected handler/decode failures are recorded through an
  adapter-scoped background failure hook while the loop keeps running.
- Replier loop failures now record unexpected errors, return a stable sanitized
  request failure message, and guard failure-response sends so send failures do
  not escape the detached loop.
- Focused regression tests cover subscriber-side non-binding, concurrent first
  publish, subscriber failure recording/recovery, and sanitized request handler
  failures.

## Round Two Findings

- TypeScript/API docs re-review reported clean.
- Documentation re-review found the API docs still lacked the ZeroMQ trusted
  same-host/private-directory warning.
- Style and performance/reliability re-review found receive loops still
  classified handler/decode/send errors by broad socket-error message text,
  allowing handler errors such as `Error("timed out")` to be swallowed.
- Security re-review found the private IPC directory trust boundary was
  documented but not enforced; the adapter must create/check the directory with
  restrictive permissions before accepting V8-serialized frames.

## Round Two Fixes

- API docs now include the ZeroMQ trusted same-host/private-directory warning.
- Receive loops now classify expected socket receive stops only around
  `receive()` calls. Handler, decode, and send failures are recorded and, for
  request handlers, return the stable sanitized failure response.
- The adapter now creates IPC directories with `0700` and rejects directories
  visible to group or other users before binding or connecting sockets.
- Focused regressions cover handler errors named like socket stops and unsafe
  IPC directory permissions.

## Focused Final Re-review

- Documentation reviewer `019f46b6-f95f-7290-999a-d6a5560188a7` reported
  clean and was closed.
- Style reviewer `019f46b7-1610-7753-ad80-eae068d57235` reported clean and
  was closed.
- Security reviewer `019f46b7-410c-7520-8244-80b6b7fd4bef` found that
  `request()` and `respond()` still bypassed private IPC directory enforcement.
- Performance/reliability reviewer `019f46b7-5acb-7573-8f2a-bc97e2bdfbad`
  found the same request/reply private-directory enforcement gap.

## Focused Final Fix

- `request()` now checks the private IPC directory before connecting a request
  socket.
- `respond()` now uses the same private IPC directory guard before allocating
  and binding a reply socket.
- The unsafe-directory regression now covers publish, request, and response
  registration paths.

## Focused Security And Reliability Re-review

- Security reviewer `019f46bb-9550-7e21-af5d-1dd698489771` reported clean and
  was closed.
- Performance/reliability reviewer `019f46bb-96ae-79b3-8492-7c6e50b4ff01`
  confirmed the private-directory bypass was closed, then found that
  `respond()` still allocated a `Reply` socket before the guard could reject.
- The `respond()` guard was moved before `Reply` socket allocation.
- Final performance/reliability reviewer
  `019f46bd-73be-70c0-9d4c-aa3a8fdcea16` reported clean and was closed.
