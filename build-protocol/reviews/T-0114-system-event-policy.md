# T-0114 Review Log

Status: Clean; release and post-merge verification passed

## Scope

Reviews the internal EventBus storing/forgetting policy only. System Context
assembly, system-schema bus roles, repositories, lifecycle events, examples,
and broad documentation remain outside T-0114.

## Human Requirements

Reviewers must check the complete ledger in
`build-protocol/tasks/T-0114-system-event-policy/TASK.md`, especially default
forgetting for the later System Context, zero EventStore access for forgotten
events, unchanged public storing construction, and no accidental public API.

## Assignments

| Concern                 | Agent and explicitly dispatched profile                  | Status                                                                                                       |
| ----------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Style/maintainability   | `/root/t0114_style`; `gpt-5.6-terra` / high              | Clean after targeted re-review.                                                                              |
| Documentation           | Existing documentation reviewer; `gpt-5.6-luna` / medium | N/A: no public prose or user workflow changed; deterministic TSDoc checks cover the narrow internal wording. |
| TypeScript/API docs     | `/root/t0114_api`; `gpt-5.6-terra` / high                | Clean after final targeted confirmation.                                                                     |
| Performance/reliability | `/root/t0114_reliability`; `gpt-5.6-terra` / high        | Clean after final targeted confirmation.                                                                     |

Every relevant dispatch must pass model and reasoning explicitly. Actual
runtime metadata or the immutable configured role/profile limitation must be
recorded before accepting results.

## Mechanical Pre-Review Evidence

- Focused EventBus suite: 36/36 passing.
- Changed `event-bus.ts` coverage: 97.14% statements, 92.18% branches,
  98.38% functions, and 97.42% lines.
- Build/tooling typecheck, focused ESLint, formatting, TSDoc, TypeDoc/export
  scan, generated cleanliness, and `git diff --check` passed.
- Package-root diff confirms no new export.
- Status lint found this log's stale pre-implementation heading and corrected
  it before reviewer dispatch. No other current-status or public-claim issue
  was found.

## Wave 1 Result

Available runtime metadata for every reviewer is the immutable explicitly
dispatched role/profile; independent self-introspection was not exposed and no
visible mismatch occurred.

Accepted consolidated findings:

1. **P1, reliability:** a forgetting bus still requires an `EventStore`.
   Constructing a real store opens backing record storage and EventBus close
   invokes its close hook. The internal factory must construct a forgetting bus
   with no EventStore ownership or lifecycle access. An end-to-end spy must
   prove zero creation, lookup, append, and close across construction, post,
   and close.
2. **P2, style/reliability:** tests must prove validation, admission, dispatch,
   and subscriber order and prove that validation or admission failure
   suppresses all later stages while storage remains untouched.
3. **P2, style/API:** internal TSDoc must describe dispatched rather than only
   stored subscriber events, and must accurately document the internal
   forgetting-bus factory without presenting it as public policy.

The findings overlap and return as one correction batch to the existing
implementer `/root/t0114_impl`. Only style, TypeScript/API, and reliability
concerns reopen. Documentation remains N/A.

## Correction Verification

- P1 reliability resolved in the implementation context: forgetting assembly
  takes no EventStore, the resulting EventBus owns no EventStore, and close has
  no EventStore lifecycle hook to invoke. Focused spies prove zero backing
  storage creation, append, read, and close through construction, post, and
  close.
- P2 style/reliability resolved: focused tests prove
  validate-to-accept-to-dispatch-to-subscriber ordering, plus validation and
  admission failures suppress all later stages with zero storage access.
- P2 TypeScript/API resolved: EventSubscriber now describes dispatched events;
  the internal access object and factory describe package-internal assembly;
  public EventBus construction retains its storing EventStore signature. The
  TypeDoc API check still reports 235 expected server exports.
- Implementer verification: 38/38 focused EventBus tests pass. Source-scoped
  `event-bus.ts` coverage is 97.15% statements, 92.64% branches, 98.38%
  functions, and 97.43% lines. Typecheck, focused lint, formatting, TSDoc,
  TypeDoc/export, generated-clean, and diff checks pass.
- Targeted re-review remains required for style, TypeScript/API, and
  reliability. Documentation remains N/A because public prose and workflows
  did not change.

## Targeted Re-review Result

- Style/maintainability is clean with no P0-P2 findings.
- Reliability accepted the storage-free factory and ordering/failure behavior,
  then found one P1: the implementation used absent `#eventStore` as its mode
  discriminator, allowing untyped JavaScript `new EventBus(undefined)` to
  select forgetting without the internal factory. The final correction must
  retain a separate private mode marker and prove invalid public construction
  cannot create a forgetting bus.
- TypeScript/API accepted public signature/export isolation and subscriber
  wording, then found one P2: the factory contract TSDoc belongs on the
  `EventBusAccess` interface declaration so internal consumers and declarations
  receive it.
- These findings return as one final targeted correction batch. Only API and
  reliability reopen afterward; style remains clean.

## Final Targeted Correction Verification

- P1 reliability correction: forgetting mode now uses a private WeakSet marker
  set only by the sentinel/internal factory. The public constructor explicitly
  rejects untyped `undefined`, so it cannot become a forgetting bus.
- P2 TypeScript/API correction: forgetting-factory TSDoc is on the
  `EventBusAccess` interface declaration and removed from the object literal.
- Focused evidence: RED was 1 expected failure in 39 tests; GREEN is 39/39
  tests passing. Changed-source coverage is 96.81% statements, 91.66%
  branches, 98.41% functions, and 97.05% lines.
- Build/tooling typechecks, focused lint, TSDoc, TypeDoc/export,
  generated-clean, format, and diff checks were run.

## Final Review Outcome

- Reliability confirms untyped `new EventBus(undefined)` throws, only the
  module-private sentinel and factory set the forgetting marker, and forgotten
  buses own or touch no EventStore during construction, post, or close. Clean.
- TypeScript/API confirms declaration-level factory TSDoc, unchanged public
  constructor and export surface, and no declaration leakage. The focused
  EventBus/root-export suites pass 49/49 and API checks retain 235 server
  exports. Clean.
- Style remains clean; documentation remains a justified N/A.
- No P0-P2 finding remains. Every reviewer used its explicitly dispatched
  immutable profile; independent runtime self-introspection was unavailable
  and no mismatch was visible.
