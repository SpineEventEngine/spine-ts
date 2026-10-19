# Command outcome subscriptions and subscription startup timeouts

Status: implemented and independently reviewed; all accepted findings addressed.
The release checks and package trial passed. The plan below records the approved
scope; the short result summary is in [TASK.md](TASK.md).

This is an addition to the existing `sql-delivery-subscription-reliability`
branch in its current worktree. Do not create another branch or worktree, reset
to master, or change other agents' files. The author approved implementation
after independent review of this plan.

## Purpose and binding requirements

An application should be able to subscribe to several possible Events and
rejections before posting a Command, then receive continuing updates. It can
optionally limit activation and ask to be notified if the first update is late.

- Subscriptions deliver **updates**. Events and rejections are Command
  **outcomes**. A posting acknowledgement establishes acceptance, not completed
  processing.
- Use `activationTimeoutMs`, `firstUpdateTimeoutMs`, and
  `onFirstUpdateTimeout` consistently, including in `postAndSubscribe`.
- Neither timeout has a default. Do not introduce a 30-second client deadline.
- The first-update timeout fires once and leaves the subscription active.
  Receiving the first update clears it permanently for that logical
  subscription. It is not an idle timeout between updates.
- Continue receiving multiple updates until application cancellation or stream
  termination. Do not automatically complete after the first outcome.
- Use Spine JVM's existing origin construction and equality semantics. Do not
  substitute an ID-only comparison or introduce another correlation mechanism.
- Applications pass their Command message and generated schema directly. Do
  not introduce a public prepared-Command object, manual Command IDs, framework
  envelope construction, `waitForUpdate()`, or `waitForOutcome()`.
- Do not automatically repost Commands, replay Events, add persistence, or
  introduce application shutdown timers.
- Extend the existing browser, Node, and React APIs; do not hide otherwise
  reusable subscription capabilities exclusively inside the new helper.
- Update public documentation and use the features in the actual Message Board
  and Todo examples. Use domain-correct Protobuf types.
- There are no production applications requiring compatibility aliases or data
  migration. Do not add such work.
- Keep disposable review and verification records out of commits. This plan is
  a requested durable artifact; retain only a short result summary in TASK.md.

## Current foundation

The current branch already makes `activate()` wait for the server's readiness
acknowledgement and supports retrying failed cancellation. Its existing
`updates` and `lifecycle` streams each allow one consumer. Node uses the shared
browser-safe client implementation; React consumes these streams through hooks.

`post()` currently creates a fresh Command internally. The helper must reuse
that internal creation/posting machinery while sending exactly the Command
whose origin was used in its subscription filters.

Event topics currently reject field filters. The server must implement the
existing origin filter, including validation. Produced-only non-internal Event
types are already exposed; no new registration mechanism is needed.

The current `ClientOutcome` describes the immediate posting acknowledgement.
Rename that affected public type and its references to a clearer name such as
`CommandAcknowledgement`; preserve its actual admission semantics.

## Public usage to implement

The following snippets describe the intended API, not existing functionality.
Generated schemas, messages, and UI functions come from the example application.

```ts
const client = Client.forGrpcWeb("https://api.example.com");
const request = client.onBehalfOf("alice");

const subscription = await request.createSubscription(topic, {
  kind: "event",
  firstUpdateTimeoutMs: 10_000,
  onFirstUpdateTimeout: () => {
    showNoUpdatesYet();
  },
});

await subscription.activate({ activationTimeoutMs: 3_000 });

async function receiveUpdates(): Promise<void> {
  for await (const update of subscription.updates) {
    applyUpdate(update);
  }
}

void receiveUpdates().catch(showSubscriptionError);
enableUserInterface();
```

`request` is just the existing actor-selected client API. `asGuest()` is also
supported. `for await` suspends its asynchronous function while waiting; it does
not block the browser thread. Code after the loop in that function waits for
the loop to end. Documentation must show activation error handling, detached
consumer error handling, and explicit cancellation, rather than suggesting a
bare indefinite loop is the complete browser startup flow.

```ts
const posting = await request.postAndSubscribe(PostMessageSchema, postMessage, {
  events: [MessagePostedSchema],
  rejections: [MessageAlreadyPostedSchema],
  activationTimeoutMs: 3_000,
  firstUpdateTimeoutMs: 10_000,
  onFirstUpdateTimeout: () => {
    showMessageStillAwaitingConfirmation();
  },
});
```

On accepted posting, expose its acknowledgement and subscription handle. The
handle may already be canceled if application code canceled it from the timeout
callback before the acknowledgement arrived. On posting refusal, expose the
acknowledgement without a subscription handle and close local update streams;
retain any failed remote cleanup in the client as described below. Setup,
protocol, and transport failures remain errors. Model acceptance and refusal
with discriminated TypeScript types so access to the subscription does not
require unsafe assertions. Refine names and complete examples before
implementation; do not present illustrative snippets as already callable APIs.

Existing single-Topic subscription calls stay supported. Add a schema-list
overload for several Event/rejection types with `kind: "event"`; it observes
those types generally. Only `postAndSubscribe` supplies its Command-specific
origin filters automatically. Use the same logical subscription lifecycle for
single-type and grouped subscriptions, and keep update payloads compatible with
the existing delivery stream rather than creating another stream abstraction.

## Timing and lifecycle contract

### Activation

`activationTimeoutMs` measures the complete initial setup, including Subscribe,
the activation acknowledgement, and setup retries. For a group, all members
share one deadline and all must be ready. Expiry rejects activation with a
recognizable timeout error and prevents the helper from posting.

Concurrent activation callers share the existing activation attempt. Define and
test how its initial options govern that attempt; do not silently create
multiple activation attempts or deadlines. Reject invalid duration values
before network work. Absent options impose no new client deadline.

Existing gateway operation limits, abandoned-definition expiry, reconnect
budgets, and cleanup limits have different purposes. Audit their interaction
and document it honestly. Do not describe them as client activation defaults,
or promise that disabling a client timer disables transport/server failures.

### First update

For an ordinary subscription, start `firstUpdateTimeoutMs` when activation
succeeds. For `postAndSubscribe`, start it immediately before sending the
Command, after every subscription is ready. Group setup must not consume the
allowance for observing the Command's outcomes.

The first actual matching update from any selected type satisfies the timer;
the first valid Entity state delivery satisfies it for Entity subscriptions.
Readiness acknowledgements, heartbeats, empty protocol envelopes, and lifecycle
notices do not. A successful authoritative Entity recovery delivery counts,
including an empty result, consistent with the existing `updates` contract.

Clear the timer at update receipt, not at application consumption. Preserve
updates arriving before the posting acknowledgement. Never restart the timer
after a first update or reset the original deadline during reconnects.

On expiry, notify once through `onFirstUpdateTimeout` and keep the subscription
active. Late updates remain deliverable. The application may explicitly cancel.
Cancellation, client closure, or terminal stream failure clears pending timers;
retired React subscriptions cannot call stale callbacks. Use monotonic elapsed
time and deterministic timer tests.

Make configured first-update timeouts observably useful: define validation for
missing callbacks rather than silently creating a timer that cannot notify the
application. The callback must be usable even if it fires before the helper's
posting acknowledgement returns; supply access to the active subscription if
needed for safe cancellation rather than relying on an uninitialized outer
variable. Reporting thrown/rejected callback errors must not silently stop
updates or produce unhandled asynchronous errors. Finalize that small error
contract with the public types before implementation.

### Cancellation and failure

Cancel all created members after partial group setup or unsuccessful posting,
and close their local streams. Settle local activation timeout promptly rather
than waiting indefinitely for cleanup. Preserve the primary failure. A failed
remote cancellation cannot guarantee that the server has stopped the stream.

Keep failed remote cleanup tracked by the client, including late Subscribe
acceptance and failures where no subscription handle reaches application code.
Expose cleanup failure separately from the posting acknowledgement or primary
setup error. Make explicit `client.close()` retry incomplete cleanup: concurrent
calls share one attempt, a later call can retry a failed attempt, and new work
remains rejected once closure begins. Keep the transport available for those
cleanup requests until they succeed, then release it. Document that unsuccessful
closure leaves cleanup resources available for retry. Do not add automatic
application shutdown or a background retry loop. Retain direct retry through
`subscription.cancel()` when the application has a handle. Test both browser
and Node transport teardown, including the Node HTTP/2 session.

Once a group is active, a member's terminal failure terminates the logical
subscription: propagate the failure to its update consumer, emit the terminal
lifecycle notice, clear its first-update timer, and cancel sibling streams.
Unexpected member completion also ends the group with a recognizable error;
do not silently keep a reduced set of selected types. Recoverable reconnects
remain governed by existing lifecycle behavior. Sibling cleanup failures follow
the same retained cleanup path and must not replace the original failure.

An outcome arriving before a transport failure does not justify automatic
reposting. A first-update timeout does not establish Command failure or reverse
its effects. Reconnect can leave gaps; no replay or eventual-observation promise
is added. Keep group buffering bounded and do not promise a total order across
independent wire streams. Validate/deduplicate type selections without opening
duplicate subscriptions; reject an empty combined selection before sending.

## JVM matching prerequisite

Use the JVM path `Event.context.past_message == command.asMessageOrigin()` with
normal Protobuf value equality. Origin construction includes the signal
identity, actor context, and preceding origin where present. It refers to the
immediately preceding signal, not an invented root-chain match.

The starting gateway replaces the Command's ActorContext, including its
timestamp, which makes the expected Origin differ from the Event's Origin.
Preserve the original Command context after the existing authentication,
authorization, context resolution, and actor/tenant checks. Queries and
subscription Topic contexts keep their resolver-supplied context. Command
creation time and locale remain caller-supplied request metadata; preserve
isolation from mutable policy/resolver request views.

Use stable Protobuf value equality for the complete supported Origin. Reject
expected Origin filters containing unknown fields in their nested message
structure; actual Origins with such fields do not match. Leave packed Any
payloads opaque. This preserves JVM equality for supported filters without
silently ignoring unknown fields or introducing a general comparator.

Source baseline checked during analysis: core-jvm
`1ebc52b91936cddb8c79de744ec2712e7dc6fe50`, `EventsAfterCommand.java`,
`Signal.java`, `FilterMixin.java`, and `OperatorEvaluator.java`. Recheck relevant
upstream changes when implementation starts. Use current branch instructions;
do not copy historical behavior merely because an old test expects it.

## Public documentation deliverables

Update the browser, Node, and React package READMEs and references, framework
User Guide, browser client/gateway guide, affected public TSDoc/API pages, and
Message Board and Todo guides. Show:

- Complete client/request creation with actual generated domain imports.
- Ordinary and multiple-type subscriptions, with and without configured limits.
- `postAndSubscribe`, acknowledgement handling, and continued update delivery.
- Non-blocking plain browser/Node consumption with error handling.
- React hooks/callbacks, per-update handling, and cancellation on retirement.
- Timeout notification followed by a late update, and explicit cancellation.
- Acceptance versus processing, configured example values versus defaults,
  subscription gaps, and the absence of automatic reposting.

Keep runnable snippets in example source and compile/test them against public
exports. Do not expose internal envelopes or lifecycle helpers in user code.

Extend `useEventSubscription` with the existing Entity hook's optional
`onDelivery` and `onLifecycle` callbacks, including grouped subscriptions. Invoke
the delivery callback for every delivery consumed by the hook; latest-value
React state alone can coalesce rapid updates. Keep one consumer per stream.
The Message Board posting form will consume its helper subscription directly
from the user-triggered posting flow, with explicit error handling and component
cleanup. Do not post Commands from an effect or feed that same stream to a hook.
Test two rapid updates in both the hook and the posting flow.

## Examples that will use the API

### Message Board: React posting form and continuing board updates

Change the real `web/src/post-form.tsx` flow to `postAndSubscribe`, observing
`MessagePosted` and `MessageAlreadyPosted`. Show accepted posting separately
from confirmation, business rejection, activation failure, and delayed first
update. A timeout notice says confirmation has not arrived, not that posting
failed, and must not automatically resend. Handle late confirmation normally.

Cancel the per-post subscription after the application has handled its relevant
outcome, on explicit abandonment, or component retirement. Preserve abort and
stale-generation protection. Keep the board-view Entity subscription continuing
through multiple changes. Idle boards are valid: do not configure a first-update
warning there solely to demonstrate the option. Activation limits may be shown.

Keep existing local/shared deployment choices, including local Message Board
without shared Delivery. Explain both application-selected lifetimes in its
guide and exercise the real browser UI, including responsiveness while waiting.

### Todo: runnable Node smoke client and existing domain scenarios

Refactor the runnable `scripts/smoke.mjs` client to use the public Node client and
helper instead of manual Command envelopes. Demonstrate existing domain behavior:

- CreateTask with an initial assignee produces TaskCreated and TaskAssigned;
  receive both and explicitly cancel after the application expects both.
- AssignTask can produce TaskAssigned or TaskReassigned, and declares
  TaskAlreadyDone and TaskAlreadyAssigned; select multiple Event and rejection
  types and demonstrate real alternative outcomes.
- Exercise an invalid transition to distinguish a rejection from a posting
  refusal. Do not add domain behavior or fixture messages solely to fill arrays.

Retain authoritative TaskList projection checks: receiving an Event does not
prove its Projection has caught up. Document the existing runnable command and
supported single-process SQL modes. Do not add shared Delivery or change Todo's
deployment model. Orders and Projects are outside this feature's example scope.

## Implementation sequence and acceptance

1. Reproduce origin mismatch and establish the JVM-compatible correction.
2. Finalize types, callback/error details, and compileable public examples.
3. Implement validated origin filters through the existing server protocol.
4. Implement optional activation/first-update timing and grouped subscriptions.
5. Compose `postAndSubscribe`, sending one internally created Command once.
6. Update Node exports, React integration, public docs, Message Board, and Todo.
7. Run focused tests and independent reviews, correct accepted findings, then
   run the required repository verification once the work converges.

Focused acceptance covers silent activation, no first update, deadline races,
multiple later updates, silence after the first update, late updates after a
notification, omitted limits, callback failure, cancellation, stale React work,
partial setup, cleanup failure and repeated explicit client closure, late
Subscribe acceptance, group member termination and sibling cleanup, callback
cancellation before the posting acknowledgement, rapid consecutive React
deliveries, early outcomes, same-type concurrent Commands, tenant isolation,
and authenticated origins. Test native gRPC, gRPC-Web, and
Connect. Use fake time for timer edge cases and real transports for lifecycle
proof; do not add long sleeps or tests solely to raise coverage. Exercise the
real Message Board UI and runnable Todo client, and compile/run public snippets.

This is high-risk public API/lifecycle work with an authentication interaction.
Implementation uses one bounded implementer and the repository's focused review
process. Review API/types, correctness/lifecycle, maintainability, and public
documentation; authentication changes receive the applicable security scrutiny.
Run cheap checks before the selected full verification profile. Preserve all
existing author corrections in TASK.md.

Follow repository commit/push/version requirements on the current branch.
Reuse its version-only commit unless current release state requires an update;
do not add a duplicate bump mechanically. No PR creation or merge is authorized.

Estimated implementation effort: 10–16 hours for implementation, verification,
examples, documentation, and review, plus CI waiting. The exact gateway context
correction is the main uncertainty.
