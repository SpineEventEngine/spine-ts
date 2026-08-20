# T-0215 work log

## 2026-08-20 — diagnosis

- Traced the repeated five-minute browser cancellation to Message Board's
  `PublicBoardAdmission`, which fabricated a five-minute `ResolvedSession`.
- Traced the HTTP 500 independently: overlapping durable authenticated-expiry
  purges competed through the per-ID queue until pre-operation maintenance
  raised `binding-busy` outside request-specific mapping.
- Recorded the human invariants: public access has no login session or expiry;
  no replacement TTL, infinity sentinel, quota, rollout change, or example-only
  retry is permitted.

## 2026-08-20 — public access and purge ownership

- Added mutually exclusive `sessions` and `publicAccess: true` modes to Unary
  and Subscription Gateways and Browser Server. Missing browser authorization
  is represented as credential absence, not an empty bearer value.
- Deleted Message Board's example admission/session fixture. Its policy and
  context resolver now authorize the framework public principal and rebuild the
  actor from request context.
- Added one store-wide durable purge owner. Concurrent callers share the active
  purge; a later greater horizon is drained in the same owner. Authenticated
  expiry stops active work, joins serialized operations, cancels the backend
  once, and deletes the durable record only after successful cleanup. Failures
  remain retryable.
- Mapped known pre-operation maintenance contention to the existing intentional
  Gateway rejection instead of allowing a raw HTTP 500.

## 2026-08-20 — rejected durable-public experiment

- An intermediate design added a durable public orphan-cleanup Proto and ledger.
  Further lifecycle analysis proved it could not safely rehydrate native
  subscriptions and contradicted the approved process-local public model.
- Reverted the implementation in forward commits, removed the Proto source,
  facade, manifests, ledger, and startup recovery, and restored generated
  metadata to the baseline. No serialized public record remains.
- Final public Gateway bindings are process-local. Gateway restart is handled by
  browser reconnect, authoritative query, and a fresh subscription.

## 2026-08-20 — activation lifecycle

- Added internal-only `SUBSCRIPTION_ACTIVATION_HANDSHAKE_MS` in Core and reused
  it in Auth, Stand, and NodeCoordinator. It bounds only the incomplete interval
  after `Subscribe` and before `Activate`; it is not an active-stream lifetime.
- Public pending cleanup retries after failure, is cancelled by Activate,
  Cancel, or shutdown, and aggregates activation and cleanup failures.
- NodeCoordinator removes pending definitions on failed setup and removes active
  definitions when activation ends. Deterministic fake-timer, cancellation,
  malformed-error, and retry tests cover the boundaries.

## 2026-08-20 — Message Board convergence

- Browser Server now owns correctly wired process-local public bindings. Message
  Board no longer supplies durable bindings, namespace settings, fake sessions,
  browser credentials, or public-binding deployment environment variables.
- Beginner docs explain that Gateway restart drops live definitions and the UI
  recovers by authoritative query followed by resubscription.
- A repository audit found no other active-subscription TTL. Remaining timers
  bound requests, cleanup, reconciliation, retries, or incomplete activation.

## 2026-08-20 — live acceptance and protocol correction

- Ran the documented two-replica local launcher with shared Delivery and the
  Datastore emulator.
- Two Chromium tabs exchanged eight alternating posts, remained connected for
  310 seconds, then both received a post after the former boundary. The test
  recorded no healthy-period Cancel response, HTTP 500/401/404, or console
  error.
- Sent real Ctrl-C to the launcher. Its Coordinator, two replicas, Gateway,
  Vite process, Datastore container, Delivery container, and listeners on
  5173/8081/8090/8091/8484 were all gone afterward.
- Added a governing protocol rule requiring an hours estimate, included work,
  and duration explanation before every future task, wave, or correction unless
  the human explicitly waives it.

## Provenance

- Requirements/public-contract analysis: existing requirements-splitting role,
  explicit `gpt-5.6-sol` / `high`.
- Normal implementation: existing implementer role, explicit
  `gpt-5.6-terra` / `medium`.
- Repository and documentation audits: read-only functions, explicit
  `gpt-5.6-luna` / `low` or `medium`.
- Runtime telemetry was unavailable on these surfaces; immutable configured
  profiles are the recorded evidence.

## 2026-08-20 — specialist review correction

- The parallel reliability, TypeScript/API, and maintainability wave used the
  existing reviewer roles with explicit `gpt-5.6-terra` / `high` profiles.
- Public Browser Server configuration now rejects any supplied binding and owns
  process-local public bindings exclusively.
- Unary, Subscription, and Browser option declarations encode the same
  session/public XOR already enforced at runtime. Deployment example aliases
  preserve the union with a distributive omit.
- Duplicate or older purge horizons no longer extend the active bounded pass;
  a genuinely later horizon still schedules one following pass.
- Admission-neutral TypeDoc replaces stale session-only wording.
- The internal Core subpath finding was dispositioned as consistent with the
  repository's private-package `./internal/*` convention; no new public root
  export was added.

## 2026-08-20 — final affected re-review correction

- Added a failure/retry regression for durable expiry maintenance: an active
  scan fails while a concurrent caller requests a later expiry cutoff, then an
  older retry must still clean records through that later cutoff. The owner now
  preserves the maximum pending cutoff across a failed attempt.
- Exported and documented the admission discriminants used by the public Unary,
  Subscription, and Browser options so generated API reference shows the real
  authenticated-versus-public shapes. Browser public mode continues to reject
  supplied bindings; authenticated mode may supply named durable bindings.
- Updated Auth, Server, and GCE/GKE Gateway documentation to say the same
  thing: durable bindings belong only to authenticated mode; public mode owns
  process-local bindings and loses them with the Gateway process.

## 2026-08-20 — final TypeDoc correction

- Exported the documented common collaborator interfaces used by Unary and
  Browser option intersections, so the generated reference displays every
  required common field and the separate admission union.
- Corrected the public ResolveContext explanation: it resolves trusted context
  for the framework public principal and omits `expiresAt`; authenticated mode
  includes the real session expiry.
- Clarified that admission selects a principal, authorization allows or rejects
  a decoded request, and the context resolver independently resolves trusted
  actor and tenant values.

## 2026-08-20 — final constituent visibility correction

- Exported documented Subscription Gateway collaborators and the Browser backend
  choice, completing TypeDoc navigation for every public option constituent.
- Corrected the Auth reference to assign public principal admission to policy
  and trusted context reconstruction to `ContextResolver`.

## 2026-08-20 — public actor admission correction

- Added an early public-actor guard to Message Board authorization. Every
  public request needs a non-whitespace requested actor before the context
  resolver runs. The guard makes missing actors ordinary forbidden responses,
  rather than resolver exceptions that native adapters surface as internal
  errors.
- Added native-adapter coverage for actorless Read, Subscribe, Activate, and
  Cancel, plus policy coverage for missing and whitespace-only actors across
  all four operations. The reference now names the shared 30-second incomplete
  Subscribe-to-Activate cleanup and explicitly states that active public
  subscriptions have no TTL.

## 2026-08-20 — final lifecycle wording correction

- Scoped the shared 30-second pending activation cleanup to public
  process-local definitions and contrasted it with authenticated durable
  session-derived expiry, while retaining the explicit no-TTL active public
  stream rule.

## 2026-08-20 — final preflight

- Registered the existing `auth.public_pending_subscription_cleanup` no-log
  containment boundary after the canonical checker exposed the missing manifest
  entry; no runtime behavior changed.
- Restarted the full cheap preflight after that correction. All deterministic
  gates pass, the focused lifecycle wave passes 350/350, and the expanded
  coverage wave passes 447/447.
- Fresh exact changed-code coverage is 144/150 executable lines (96.00%) and
  146/161 branches (90.68%).

## 2026-08-20 — release verification

- Removed accidentally tracked private planning artifacts after preserving and
  hashing their local working copies outside Git. This resolved the first
  release-readiness-only failure without weakening the checker.
- Restarted the complete cheap preflight on clean pushed SHA `65b398c9`, then
  ran the full release profile once more with no overlapping build/test process.
- The terminal release run passed 4,344 tests across 270 files, with 19 tests / 4
  files skipped by their existing gates. Global coverage is 93.47% statements,
  90.07% branches, 93.02% functions, and 94.61% lines.

## 2026-08-20 — cheap-preflight containment correction

- Registered the existing public pending-subscription cleanup log boundary as a
  no-log `auth.subscription.cleanup` operation. The manifest points to the
  established deterministic Auth subscription test; no runtime logging behavior
  or production code changed.
