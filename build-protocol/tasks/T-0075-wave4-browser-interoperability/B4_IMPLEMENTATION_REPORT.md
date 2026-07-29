# B4 Implementation Report — Native relay

## Completed slices

- RED/GREEN: B3 `Activate` now carries an asynchronous, copied
  `SubscriptionUpdateSink` for the complete native backend stream lifetime.
- RED/GREEN: `SubscriptionUpdateRelay` copies updates, delivers FIFO, applies
  the 64-message/1-MiB defaults, and maps count-first overflow to Connect
  `ResourceExhausted` with a deterministic message.
- Added the injected Connect 2.1.2 `NativeSubscriptionCreator`, which uses the
  shared Command, Query, and Subscription service descriptors and never
  forwards browser credentials or non-allowlisted transport facts.
- Added `createNativeGatewayServices`: Post/Read delegate through `UnaryGateway`
  and Subscribe/Activate/Cancel through `SubscriptionGateway`. In particular,
  public Activate never calls `SubscriptionCreator` directly.

## Evidence

- RED: sink callback was absent (`updates is not a function`); relay export was
  absent (`SubscriptionUpdateRelay is not a constructor`).
- GREEN: focused auth tests pass: 2 files / 36 tests.
- Auth TypeScript typecheck passes after adding DOM library declarations required
  by the installed Connect transport types.

## Pre-review correction evidence

- The gateway request now admits an optional downstream `AbortSignal` as a
  control capability. The in-memory B3 binding bridges it to the active backend
  effect only, removes the listener after completion, and preserves B3 as the
  sole cancellation/disposal owner.
- A quiet activation regression aborts that signal, observes the backend abort,
  one mandatory B3 cancellation callback, and zero retained bindings.
- Relay waiters now retain both resolve and reject callbacks; a terminal backend
  failure rejects an already-pending iterator `next()` rather than yielding a
  promise as a stream value.
- A typed fake Connect transport now exercises the native Post, Read, Subscribe,
  Activate, Cancel, and Dispose descriptor paths. It proves the two lifecycle
  calls use the supplied `AbortSignal`, Activate forwards copied update bytes
  through its sink, and Cancel/Dispose both use the shared Cancel descriptor.

## Handler terminal-matrix evidence

- RED/GREEN: direct typed `UnaryGateway` and `SubscriptionGateway` fakes now
  exercise `createNativeGatewayServices` rather than only the native creator.
  Post/Read and Subscribe/Cancel prove success delegation plus every gateway
  rejection-to-Connect-status mapping. Activate proves it calls only the B3
  gateway, relays copied FIFO updates, and propagates the external context
  abort capability into its linked B3 control signal.
- RED/GREEN: a quiet activation exposed that an async-generator `return()` or
  `throw()` could only close the public relay, leaving the B3 activation signal
  live. The adapter now links the external context to a local controller and
  uses an iterator wrapper so context abort, iterator return/throw, backend
  rejection, normal completion, and relay overflow converge through one
  idempotent terminal path. The regression observes a quiet fake activation
  settle on both iterator terminal operations.
- The direct matrix covers context abort before an update, already-aborted
  context, iterator return/throw, backend/gateway rejection, normal completion,
  message/byte overflow, explicit Cancel, and one handler invocation per
  terminal stream. It observes terminal stream behavior; relay internals remain
  private and are not accessed by tests.
- Fresh validation: focused handler matrix (1 file / 27 tests), full auth suite
  (5 files / 85 tests), auth `tsc --noEmit`, generated TypeDoc/API checks,
  Prettier, and `git diff --check` pass. No Spine JVM command ran.

## Validation limitation

- Specialist review is converged. The final canonical TypeScript gate passed
  146 runnable files / 2,731 tests with 25 skipped and 90.04% branch coverage
  (8,760/9,729). No Spine JVM command was run.

## Complete-review correction evidence

- RED: relay tests proved malformed update bytes left a waiting consumer pending
  and let queued bytes drain; handler tests proved a pre-aborted Activate still
  entered B3; unary tests proved handler context cancellation was not carried
  through B2. These focused regressions failed for the required missing
  behavior before their GREEN changes. The remaining lifecycle tests were added
  while completing the same bounded correction and passed against the resulting
  implementation.
- GREEN: a pre-aborted downstream Activate reaches neither B3 activation nor a
  native effect. The `SubscriptionBindings.activate` contract now requires the
  active-effect signal. Live B3 activation owns an admitted-session expiry
  timer, and natural completion invokes bounded cancellation/removal before
  public graceful drain. Context abort and iterator return/throw can supersede
  that drain and purge buffered updates.
- GREEN: the relay validates update bytes before admission, rejects waiting
  consumers, purges queued copies on malformed input, and retains independent
  count/byte limits. Tests use distinct non-empty event/entity update variants
  to prove copied FIFO delivery.
- GREEN: HandlerContext signals flow through UnaryGateway, UnaryForwarder, and
  the native Post/Read calls; B2 races a non-cooperative forward effect with
  downstream abort while preserving its security and copied-envelope pipeline.
- Public README and TSDoc now describe named native-factory options, descriptor
  mappings, abort ownership, defaults/validation, ResourceExhausted limits,
  graceful drain, and terminal purge behavior.
- Focused evidence passed: all 5 auth test files / 92 tests, auth `tsc
--noEmit`, generated TypeDoc/API checking, Prettier, and `git diff --check`.
  No install, commit, push, merge, C+ work, or Spine JVM command ran.

## Targeted re-review final correction evidence

- Assignment metadata: existing `implementer`, explicitly configured
  `gpt-5.6-terra` / `medium`. Independent runtime self-introspection is not
  exposed by this surface, so the immutable configured role/profile and
  explicit dispatch are the available evidence; no visible mismatch or
  inherited-profile fallback occurred.
- RED: a real in-memory B3 binding held a first Activate, queued a second
  Activate, aborted the queued request while it waited, then failed the first
  effect back to inactive. Before the fix, the queued operation returned
  `activated`; its native callback could therefore run after admission had
  expired/aborted.
- GREEN: activation re-checks its admitted signal after the per-binding await
  and before state transition/native callback. The forced interleaving now
  returns `denied`, invokes the queued native callback zero times, and retains
  the retryable inactive binding.
- Reflowed authored overlength lines, added `NativeGatewayServicesOptions` to
  the frozen auth API inventory, qualified successful cleanup versus retryable
  failed cleanup in the README, and completed native public TSDoc for relay,
  creator, request context, services, options, factory, and terminal mapping.
- Focused RED/GREEN verification passed `packages/auth/test/subscriptions/index.test.ts`
  (40 tests). Full auth validation then passed 5 files / 94 tests, auth
  `tsc --noEmit`, generated TypeDoc/API inventory, Prettier, and `git diff
--check`. No install, commit, push, merge, C+ work, or Spine JVM command ran.

## Full-gate branch coverage correction evidence

- Assignment metadata: existing `implementer`, explicitly configured
  `gpt-5.6-terra` / `medium`. Runtime self-introspection is unavailable on
  this surface; the explicit dispatch and immutable configured profile are the
  available metadata. No visible mismatch or inherited-profile fallback
  occurred.
- Added behavior-focused B4 tests only. They prove that a relay admits a
  valid update directly to an already waiting public consumer, rejects a
  backend update after graceful closure, and maps an unexpected B3 Activate
  acknowledgement to the public Connect `Internal` terminal failure. No
  production source, coverage threshold, ignore directive, or dependency was
  changed.
- Focused direct-run validation passed `packages/auth/test/native-relay.test.ts`
  and `packages/auth/test/native-gateway-services.test.ts`: 2 files / 38
  tests; the full focused auth suite also passed: 5 files / 97 tests. Focused
  V8 coverage covered the intended native branches. Its global threshold
  failure (84/9,729 branches) is expected because the command runs only those
  two files; canonical full-gate coverage remains coordinator work.
- Prettier passes for the added relay test and all updated durable records, and
  `git diff --check` passes. A standalone ESLint invocation reports existing
  errors elsewhere in the already-untracked B4 test files, so it is not a
  clean isolated signal for this test-only slice.
- `pnpm exec vitest` could not start because installed workspace links report a
  changed `linkWorkspacePackages` setting. No `pnpm install` was run because
  dependency changes are outside this correction. The installed
  `node_modules/.bin/vitest` executed the focused tests successfully. No
  commit, push, merge, C+ work, child dispatch, or Spine JVM command ran.
