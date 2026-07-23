# T-0065 Requirements Analysis

Status: implementation-ready

## Scope And Authority

This is a high-risk lifecycle packet. The authority is the accepted Wave 1 plan,
the current T-0064 in-memory core and T-0062 delivery client, and frozen
`SpineEventEngine/delivery-server@21f2901f393e552208b97166f4eaeb942f9f5172`.
Upstream inspection was limited to `simple-server` and its directly used Admin
and health contracts in `grpc-api`.

Behavioral and conceptual parity is required; Java storage factories, observer
wrappers, executor structure, and mutable health interfaces are not designs to
copy. The TypeScript module must put listener, stream, and shutdown complexity
behind one small public interface.

## Required Semantic Decisions

### Public interface

Keep the existing listener-free `createInMemoryDeliveryServerCore()` interface
unchanged. Add only:

```ts
export interface DeliveryServerOptions {
  readonly host?: string;
  readonly port?: number;
  readonly maxInboundMessageBytes?: number;
  readonly processingTimeoutSeconds?: number;
}

export class DeliveryServer {
  constructor(options?: DeliveryServerOptions);
  readonly host: string;
  readonly port: number;
  readonly baseUrl: string;
  start(): Promise<this>;
  close(): Promise<void>;
}
```

- Construction resolves and validates configuration once.
- `start()` is one-shot: concurrent and repeated calls share one promise and
  one listener. A failed instance is terminal and does not retry a bind.
- `port` is the configured port before startup and the bound port after a
  successful explicit `0` bind. `baseUrl` is available only after startup and
  fails clearly before then.
- `close()` is asynchronous and idempotent. Before start it makes the instance
  terminal without binding; during start it waits for the attempt and performs
  the same cleanup; after failure it completes any reached cleanup.
- Do not export state maps, the Admin publisher, health mutation controls,
  signal installers, HTTP/2 sessions, configuration parsers, or test clocks.
- The package executable is `spine-delivery-server`. It uses the same
  `DeliveryServer` interface; process signal ownership is not implicit when the
  class is embedded by a library caller.

### Configuration

Precedence is explicit option, then the named environment variable, then the
default. A defined numeric zero is not mistaken for absence.

| Meaning        | Public option              | Environment                | Default     | Validation                 |
| -------------- | -------------------------- | -------------------------- | ----------- | -------------------------- |
| Bind host      | `host`                     | `HOST`                     | `127.0.0.1` | non-blank host string      |
| Port           | `port`                     | `PORT`                     | `8484`      | integer `0..65535`         |
| Inbound bytes  | `maxInboundMessageBytes`   | `MAX_INBOUND_MESSAGE_SIZE` | `4_194_304` | integer `1..2_147_483_647` |
| Pickup timeout | `processingTimeoutSeconds` | `SHARD_PROCESSING_TIMEOUT` | `0`         | integer `0..2_147_483_647` |

`PORT`, `MAX_INBOUND_MESSAGE_SIZE`, and `SHARD_PROCESSING_TIMEOUT` are the exact
frozen names. `HOST` is the minimal TypeScript addition needed to make the
actual bind address explicit; the JVM `HOST` constant was only logging/test
metadata while `ServerBuilder.forPort()` selected the listener.

- Environment numerics accept only a complete base-10 integer string. Empty or
  absent values use the default; whitespace, signs, fractions, exponents,
  suffixes, overflow, and out-of-range values fail.
- Explicit options are numbers and receive the same range/integrality checks.
- Timeout zero disables automatic stale takeover. Positive integral seconds are
  converted exactly to milliseconds and passed to the accepted core.
- Configuration failure occurs synchronously before creating or binding an
  HTTP/2 server. Mutating `process.env` afterward cannot affect the instance.
- No CLI flag parser, config file, dynamic reload, Redis, or Hazelcast setting
  belongs in this packet.

### Internal assembly seam

Create one package-private assembly that owns:

- the existing canonical in-memory state;
- the single mutation admission boundary;
- Inbox and Shard implementations;
- an Admin snapshot/update publisher;
- the health implementation;
- the HTTP/2 listener and tracked sessions.

The public listener-free core projects only its existing Inbox and Shard
handlers from that assembly. `DeliveryServer` additionally registers
`AdminService` and `Health`. Do not add a generic storage factory, event bus,
service registry abstraction, or a dependency on `@spine-ts/server`.

All real state transitions publish from inside the existing synchronous
mutation critical section, after canonical state changes and before the RPC
mutation settles. Publisher failure or one slow subscriber must never roll
back or fail a committed Inbox/Shard mutation.

## Admin Semantics

### Snapshot

`GetShardInfo` returns the union of:

- shards with a retained session record, including released records; and
- shards containing messages but having no session record.

For each shard:

- `messages` is the actual number of canonical messages, not the number of
  write/delete RPC attempts;
- status is `PICKED` exactly when a worker currently owns the shard, otherwise
  `NOT_PICKED`;
- `last_picked` is the retained last-pick timestamp when one exists, including
  after release; message-only shards omit it.

Use an Admin-specific count holder initialized before binding and updated only
from actual map insert/delete transitions. Duplicate upserts do not increment;
missing removes do not decrement. The state mutation and count change are one
synchronous admission step, so a snapshot cannot observe a torn pair.
Snapshot order is deterministic by `of_total`, then `index`; no ordering
guarantee is copied from upstream storage iteration.

### Updates

Publish one update after each actual transition:

- a newly inserted or actually removed message;
- a successful initial pickup or stale takeover;
- an actual explicit or expired-session release.

Failed pickup, duplicate upsert, and missing removal/release publish nothing.
Batch transitions retain input order. Global update order is the serialized
mutation-admission order.

Each TypeScript `ShardInfoUpdate` carries a complete current observation:
`index`, current `new_status`, retained `when_last_picked` when present, and
current `new_messages_count`. The frozen Java helper emitted partial scalar
deltas, but the accepted T-0062 `RemoteShardObservation` contract consumes a
complete current observation and Proto3 scalar fields cannot distinguish
“unchanged” from zero. Complete frames are wire-compatible and preserve the
observable Admin meaning without broadening the public client.

### ACK, races, cancellation, and backpressure

- A new stream yields exactly one `created: true` frame first.
- The subscriber is not eligible for publication until that ACK has crossed
  the async-iterator yield. Changes before eligibility are intentionally
  discarded. No hidden replay or snapshot is attached to the stream.
- Registration after ACK and all later queue operations are synchronous; a
  change after registration is either queued once or causes terminal overflow.
- Snapshot plus subscription is not an atomic lossless handoff; the frozen
  contract makes no such promise.
- Each subscriber has exactly 100 pending update slots. ACK does not consume a
  slot. The 101st pending update clears retained frames, unregisters the
  subscriber, and terminates it once with
  `ConnectError(Code.ResourceExhausted)` and the stable sanitized message
  `"Delivery shard update buffer is full."`
- Caller cancellation/return, transport abort, overflow, server shutdown, and
  generator failure all unregister exactly once, clear the queue and waiter,
  and retain no signal payload or arbitrary metadata.
- Normal server shutdown completes active Admin streams; overflow is an error.
  No unbounded promise, queue, replay log, or per-update timer is retained.

## Health Semantics

Register and derive names from the generated descriptors:

- `grpc.health.v1.Health`;
- `spine.delivery.InboxService`;
- `spine.delivery.ShardService`;
- `spine.delivery.AdminService`;
- empty string for overall server health.

While running, `Check` returns `SERVING` for empty/all and every known name.
An unknown non-empty name returns a successful response with `NOT_SERVING`,
following the frozen implementation rather than the contradictory Proto
comment. When shutdown begins, empty/all and every known name return
`NOT_SERVING`. `Watch` always fails with `Code.Unimplemented`; do not add a
health stream.

One internal serving flag is sufficient. Do not copy the JVM per-service
mutable `HealthAware` hierarchy because T-0065 has no independent degradation
source.

## Listener, Signals, And Shutdown

- Use the pinned `@connectrpc/connect-node` adapter over a cleartext Node HTTP/2
  server and set its inbound read bound from configuration.
- Register only Inbox, Shard, Admin, and Health.
- Track open HTTP/2 sessions so shutdown cannot wait forever on an idle owned
  connection. Do not add TLS, HTTP/1, authentication, reflection, metrics, or a
  second listener.
- A successful start exposes the actual host, port, and `http://` base URL.
  Port collision rejects startup and runs the same reached-resource cleanup.

Shutdown has one shared promise and this exact order:

1. mark health non-serving;
2. close mutation admission, rejecting new and queued-not-yet-admitted
   mutations while allowing the already synchronous admitted mutation to
   finish;
3. complete and remove every Admin stream;
4. stop listening, gracefully close tracked HTTP/2 sessions, and await server
   close.

No later mutation may commit after step 2. Reads already admitted by the
transport may finish while network close proceeds. Shutdown does not erase or
persist state; the instance is terminal.

The executable installs `once` handlers for `SIGINT` and `SIGTERM`. Both call
the same shutdown promise, so either or both signals cause one teardown.
Handlers are removed after startup failure or teardown. Successful signal
shutdown allows natural process exit; startup/shutdown failure sets a non-zero
exit code after reporting a sanitized error. Do not call `process.exit()` from
the library or install `beforeExit`/`exit` handlers.

The default loopback bind is local-only. Any explicit non-loopback bind is an
unauthenticated, cleartext trusted-network deployment and must be stated
adjacent to the configuration example.

## Ordered Test-First Slices

1. **Configuration RED/GREEN:** exact defaults, option-over-environment
   precedence, parse-once behavior, zero handling, and every invalid boundary;
   prove no bind attempt on invalid configuration.
2. **Admin snapshot RED/GREEN:** message-only, picked, released, and
   shard-only states; duplicate/missing mutations; complete counts/status/time
   and deterministic ordering.
3. **Admin transition RED/GREEN:** single/batch insert/remove, pickup,
   takeover, explicit/expired release, and no-op operations through the real
   core.
4. **ACK race RED/GREEN:** pause before ACK eligibility, mutate on both sides
   of the gate, and prove one ACK followed only by post-ACK complete updates.
5. **Stream resources RED/GREEN:** exact 100/101 boundary,
   `RESOURCE_EXHAUSTED`, cancellation, iterator return, shutdown completion,
   and subscriber-count cleanup.
6. **Health RED/GREEN:** empty, all canonical names, unknown name,
   non-serving transition, and `Watch` `UNIMPLEMENTED`.
7. **Listener RED/GREEN:** real HTTP/2 gRPC calls for all four descriptors,
   inbound limit, explicit/default bind, actual ephemeral port, port collision,
   start sharing, and failed-start cleanup.
8. **Shutdown RED/GREEN:** instrument the four required phases, queued versus
   admitted mutations, active Admin stream, idle session, close-before/during/
   after-start, and repeated close.
9. **Process RED/GREEN:** spawn the package executable, verify configuration
   failure before listen, send `SIGINT` and `SIGTERM`, prove one teardown and
   handler/listener cleanup without leaked child processes or ports.
10. **Documentation and regression closure:** executable trusted-network
    example, environment table, in-memory loss warning, public declaration/
    package-bin checks, delivery-client Admin integration, focused package
    checks, then the required full repository gate.

Every behavior test must be observed failing for the intended missing behavior
before production implementation.

## Exclusive Implementation Ownership

One implementation owner may edit:

- `packages/delivery-server/package.json`, `README.md`, and `src/index.ts`;
- existing `packages/delivery-server/src/core/**` only where needed to expose
  real transition notifications and admission shutdown;
- new cohesive modules under `packages/delivery-server/src/admin/`,
  `src/health/`, `src/server/`, and `src/bin/`;
- mirrored focused tests under `packages/delivery-server/test/`;
- `pnpm-lock.yaml` only for the existing pinned
  `@connectrpc/connect-node@2.1.2` package dependency;
- exact TypeDoc/API inventory files only if the new public declarations require
  deterministic inventory updates;
- this task's work log and implementation report.

No concurrent writer owns these paths. Changes to
`packages/delivery-client` are excluded: real integration must pass against its
accepted complete-observation interface. Proto source/generated files,
`@spine-ts/server`, scheduler/supervisor production code, examples, and other
packages are read-only regression surfaces.

## Review Risks And Required Evidence

- **Style/maintainability:** reject generic observer/storage/lifecycle
  frameworks, duplicate public start helpers, Java wrapper-class copying, and
  accidental internal exports.
- **TypeScript/API:** verify the exact two added root declarations, terminal
  lifecycle behavior, package executable, no Node server implementation types
  in public declarations, and no Proto changes.
- **Documentation:** verify exact names/defaults/units/precedence, loopback
  default, trusted-network warning, in-memory loss, and no claims of durable,
  authenticated, TLS, JVM-live, or human-admin behavior.
- **Performance/reliability:** inspect linearization, count consistency,
  complete update construction, ACK gating, the 100-frame bound, subscriber
  cleanup, start/close races, HTTP/2 session closure, signal cleanup, and port
  reuse.

All four specialist lanes are required. P0/P1 and accepted P2 findings block
closure. Final security remains T-0067 unless this implementation discovers a
security-critical blocker. Full `pnpm verify` is required after review
convergence.

## Explicit Exclusions

Exclude Redis, Hazelcast, durable persistence/recovery, clustering, TLS,
authentication/authorization, public-Internet hardening, health `Watch`,
dynamic configuration, CLI flags, graceful-shutdown policy knobs, a human
admin UI/TUI, deployment/container packaging, live TS/JVM execution, Proto
edits, and changes to delivery scheduling/supervision.

No genuine pre-implementation ambiguity remains. The complete Admin update
shape is the necessary wire-compatible reconciliation between frozen
simple-server meaning and the already accepted TypeScript delivery-client
interface.
