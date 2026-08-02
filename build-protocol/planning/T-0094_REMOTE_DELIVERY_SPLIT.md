# T-0094 Remote Delivery Split

Dispatch metadata: existing role `requirements_splitter`; explicitly dispatched
profile `gpt-5.6-sol` / high reasoning. The execution surface does not expose
runtime model/reasoning self-introspection, so the immutable configured role and
explicit dispatch are the available acceptance evidence.

## 1. Smallest cycle-free public configuration shape

Keep the dependency direction exactly as it is: `delivery-client` may import
`server`; `server` must not import `delivery-client`.

The server package owns one generic lifecycle port:

```ts
export interface ServerEnvironmentDelivery extends ServerEnvironmentCloseable {
  open(): unknown;
}
```

`ServerEnvironmentSettings.delivery` accepts the existing close-only local
delivery owner or this openable subtype, preserving source compatibility. The
environment calls `open()` only when it is present. No endpoint, Connect,
quarantine, or remote-adapter type crosses into `server`.

The delivery-client package owns the only remote-specific configuration:

```ts
export interface RemoteDeliveryConfig {
  readonly endpoint: string;
  readonly removalQuarantine: RemovalQuarantine & ServerEnvironmentCloseable;
  readonly clientOptions?: DeliveryClientOptions;
}

export class RemoteDelivery implements ServerEnvironmentDelivery {
  static connectTo(config: RemoteDeliveryConfig): RemoteDelivery;
}
```

Application assembly is one setting, with storage and transport still selected
by the application:

```ts
ServerEnvironment.when(EnvironmentType.Production).use({
  storageFactory,
  transport,
  delivery: RemoteDelivery.connectTo({ endpoint, removalQuarantine }),
});
```

`RemoteDelivery` owns a lazy, retryable resource bundle. Each open attempt
creates one `DeliveryClient.connectTo()` client, gives that same client to one
`RemoteInbox` and one `RemoteWorkRegistry`, and feeds those adapters into the
existing `DeliveryBuilder`. A bounded `DeliveryClient.shardSnapshot()` is the
startup reachability check; it adds no health service or application endpoint.
The returned object, not `ServerEnvironment`, knows the concrete client,
adapters, builder, and quarantine types.

The supplied quarantine is semantically durable and its ownership transfers to
the environment. There is no storage-provider selector: the application creates
the quarantine using its selected storage implementation before configuration.

## 2. Ownership, open, rollback, and close order

One `ServerEnvironment` owns exactly one configured remote-delivery object.
That object exclusively owns its current built delivery facility, client-owned
HTTP/2 session and streams, and supplied quarantine. The inbox and registry are
adapters, not separately closeable owners.

Open is serialized and coalesces concurrent callers:

1. Validate and snapshot endpoint/options without publishing resources.
2. Create one fresh client-owned `DeliveryClient`.
3. Create `RemoteInbox` and `RemoteWorkRegistry` over that exact client and
   assemble the existing facility through `DeliveryBuilder`.
4. Complete the bounded Admin snapshot readiness call.
5. Publish the assembled bundle as open.
6. Only then enter `EnvironmentAttachments.attach()`; A1 guarantees attachment
   precedes listener intake.

If steps 2-4 reject, rollback stops any started delivery facility and closes
the fresh client, thereby aborting streams and the owned session. Nothing is
published and `EnvironmentAttachments.attach()` is never called. The durable
quarantine remains environment-owned and open for the next attempt. The next
`open()` creates a fresh client and adapters; it never reuses a failed client.
Concurrent callers observe the same attempt and a rejection clears only the
attempt promise.

Final shutdown order is:

1. Server listener intake stops.
2. Every server-owned/caller-owned environment attachment detaches and its
   delivery generation becomes quiescent.
3. The built remote delivery facility closes.
4. `DeliveryClient.close()` aborts observations/calls and its owned session.
5. The removal quarantine closes.
6. The signal transport closes.
7. The tracer factory closes.
8. The storage factory closes.

`ServerEnvironment.close()` continues to reject before facility teardown while
attachments remain. Each close owner keeps a phase checkpoint. Concurrent
close calls share one in-flight promise; a repeated successful close is a
no-op; after rejection, retry resumes at the first unfinished phase and never
re-closes a completed phase. Closing before a successful open still closes the
transferred quarantine exactly once.

## 3. Exact RED tests

Create `packages/delivery-client/test/remote-delivery.test.ts` with these
initial failing cases:

1. `builds one remote environment delivery from an endpoint and durable quarantine`
   — both adapters receive the same fresh client, the existing builder receives
   those adapters, and no storage/provider selection occurs.
2. `completes bounded Admin readiness before publishing the remote delivery`
   — the facility is unavailable until `shardSnapshot()` resolves and the call
   is bounded.
3. `coalesces concurrent open calls into one client and one readiness attempt`
   — two opens share one promise and allocate once.
4. `rolls back a failed open and retries with a fresh client without closing the quarantine`
   — failed readiness closes the failed facility/client, publishes nothing,
   leaves no active stream/session, and the next open allocates afresh.
5. `closes delivery client and quarantine in dependency order exactly once`
   — concurrent and repeated close produce `delivery, client, quarantine` once.
6. `retries only unfinished remote close phases after each phase failure`
   — table-drive failures at delivery, client, and quarantine and assert prior
   successful phases are not repeated.
7. `closes the transferred quarantine when the environment owner never opened`
   — close-before-open owns and closes the quarantine once without allocating a
   client.

Extend `packages/server/test/server/server-environment.test.ts` with these
initial failing cases:

1. `opens configured delivery before the first environment attachment`
   — an attach probe cannot run until the delivery-open gate resolves.
2. `does not create an attachment when configured delivery open rejects`
   — configured/active attachment counts remain zero and the next attach invokes
   a fresh open attempt.
3. `coalesces delivery open across concurrent attachment attempts`
   — one open invocation precedes both serialized attachment admissions.
4. `keeps existing close-only local delivery configuration compatible`
   — a local closeable with no `open` still attaches and closes normally.
5. `closes delivery transport tracer and storage in the approved order`
   — after attachment retirement, observe `delivery, transport, tracer, storage`.
6. `retries only unfinished environment close phases after partial failure`
   — table-drive each facility failure and assert completed phases remain at one
   call across concurrent/repeated retry.

The RED commit must contain only tests/test seams and must be pushed before any
production implementation. GREEN may begin only after each named test is
observed failing for its intended missing behavior rather than fixture or type
errors.

## 4. Exact owned paths

One implementation owner exclusively owns:

- `packages/delivery-client/src/remote/remote-delivery.ts` (new)
- `packages/delivery-client/test/remote-delivery.test.ts` (new)
- `packages/delivery-client/src/index.ts`
- `packages/delivery-client/README.md`
- `packages/delivery-client/REFERENCE.md`
- `packages/server/src/server/server-environment.ts`
- `packages/server/test/server/server-environment.test.ts`
- `packages/server/src/index.ts`
- `packages/server/README.md`
- `packages/server/REFERENCE.md`

`packages/server/src/server/environment-attachment.ts` is read-only unless a
RED test proves its existing admission/rollback checkpoint cannot enforce the
open-before-attach boundary. If that proof exists, the same implementation
owner may make the minimum compatible change there and its mirrored existing
test only; this is not a second ownership stream.

Neither package manifest should change: the existing `delivery-client ->
server` dependency is sufficient and a reverse dependency is forbidden.

## 5. Preflight, review, and release gates

Before review, require all named RED tests GREEN, the complete focused server
environment suite and delivery-client remote suite GREEN, changed-source branch
coverage at 100%, public declarations generated without a dependency cycle,
and the canonical cheap preflight GREEN. Deterministic checks must also prove
that the two package manifests retain only the existing dependency direction
and that no health route, provider selector, runner, worker, supervisor, or new
delivery-server mode was added.

Collect one complete review wave before corrections. Record every canonical
lane disposition:

- correctness/DDD: ownership transfer, failed-open rollback, retry checkpoints,
  attachment-before-listener invariant, and durable-quarantine semantics;
- performance/reliability: coalesced concurrency, bounded readiness, stream and
  session cleanup, close ordering, and no unbounded retry/allocation;
- TypeScript/public API/docs: minimal structural port, compatibility of local
  settings, exports/TSDoc, and beginner/agent snippets;
- style/maintainability: one remote owner, reuse of builder/adapters/client, and
  absence of parallel lifecycle or provider abstractions.

Return one aggregated accepted correction batch to the same implementation
owner and re-open only substantively affected lanes. After convergence, run the
canonical cheap preflight again, then run `verify:release` exactly once because
this changes shared runtime and public lifecycle assembly. Task closure also
requires the task branch, review-correction commits, merged `main`, and any task
tag to be pushed according to the build protocol.

## 6. Blockers

No current architecture blocker. Implementation must stop and return to the
requirements boundary only if A1 no longer guarantees that environment
attachment completes before listener intake, the current `DeliveryBuilder`
cannot accept the existing `RemoteInbox`/`RemoteWorkRegistry` pair, or the
supplied quarantine cannot satisfy both durable removal semantics and one-owner
close. Those findings would change the frozen public or ownership contract;
ordinary typing or test-seam work is not a blocker.
