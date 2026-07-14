# T-0039b Review Log

Status: Review round 4 assigned

## Review Scope

- Baseline: `0868ecca`.
- Review root/package READMEs, API overview, public TSDoc, focused docs/API
  assertions, and the three T-0039b durable records only.
- Ignore historical superseded text unless current task records, changed public
  docs, or current top summaries claim it as active behavior.

## Concern Dispositions

- Style/maintainability: relevant for bounded structure, duplication, readable
  package ownership, and preservation of accurate detail.
- Documentation: relevant for factual completeness, links, commands, examples,
  limitations, and active-vs-historical truth.
- TypeScript/API docs: relevant for exports, TSDoc, public imports, declaration
  meaning, compatibility, and internal-type leakage.
- Performance/reliability: relevant for lifecycle, bounded delivery, retry,
  transport, storage, and ownership claims.
- Security: deferred to T-0041 by protocol.

## Expected Profiles

- Documentation: existing reviewer, explicit `gpt-5.6-luna` / medium.
- Style, TypeScript/API docs, and performance/reliability: existing reviewers,
  explicit `gpt-5.6-terra` / high.
- All reviewers are read-only/no subagents and receive one bounded concern over
  an immutable original-baseline package.

## Author Assignment

- Existing implementer, explicit `gpt-5.6-terra` / medium, no subagents.
- Author must keep runtime/public exports unchanged, use package imports in
  public snippets, preserve exclusions, and report exact focused evidence.

## Author Handback For Review

- Review only the T-0039b document/record diff: `README.md`, the six required
  package READMEs, `docs/api/README.md`, and the three T-0039b records. No
  source, export, generated, dependency, user-guide, or example change is
  intended.
- Verify the revised ownership/lifecycle/transport/exclusion/manual-API prose
  against `package.json`, `RUNTIME_ARCHITECTURE.md`, and `DEVELOPER_API.md`.
  Package snippets use package imports; `@example/tasks-proto` is an
  illustrative application package name, not a repository-relative generated
  path.
- Author evidence: `pnpm docs:check` reports TypeDoc export counts
  `100/28/205/19/17/3`; focused metadata/root-export tests pass `7` files /
  `71` tests; `pnpm typecheck:build` and `pnpm typecheck:generated` pass;
  exact-path Prettier and focused phrase/import/end-user API/Markdown-target
  scans pass. First docs check was blocked only by absent local workspace build
  declarations and passed after the required local build.
- Canonical concern dispositions remain coordinator-owned: style,
  documentation, TypeScript/API docs, and performance/reliability are relevant;
  security is deferred to T-0041. No review finding has been accepted or fixed
  by the author.

## Coordinator Pre-Review Round 1

Pre-review lint is not an independent reviewer wave. It found three concrete
issues before reviewer dispatch: the `packAny()` snippet throws under its
default validation path; API-overview close ordering omits transport drain and
delivery detach/quiescence and contradicts the hard-gate retry contract; and
the unshipped illustrative `@example/tasks-proto` name is not identified as a
consumer substitution. The complete batch is assigned back to the existing
implementer with explicit immutable `gpt-5.6-terra` / medium execution, bounded
docs/records ownership, and no subagents. Independent reviewer round 1 remains
pending until focused coordinator validation accepts the fixes.

## Implementation Fix Handback Round 1

- Finding 1 fixed in `packages/core/README.md`: the default-validation example
  now packs and unpacks a valid public `FieldPathSchema` message, proven through
  built `@spine-ts/core` and `@spine-ts/proto` package imports.
- Finding 2 fixed in `docs/api/README.md`: `RunningServer.close()` now records
  listener/session close, context transport intake/drain, delivery
  detach/quiescence, context/resource close, owned-environment close, and the
  network/context hard gate before downstream cleanup.
- Finding 3 fixed in `packages/server/README.md`: the first illustrative
  `@example/tasks-proto` use is preceded by a consumer-substitution note.
- Author verification: the built-package round trip printed
  `type.spine.io/spine.base.FieldPath task.title`; `pnpm docs:check` passed with
  expected exports `100/28/205/19/17/3`.
- No reviewer wave has started. Coordinator focused verification remains the
  acceptance gate before independent reviewer round 1.

## Coordinator Verification Round 1

The coordinator independently accepted all three fixes after a built-package
round trip, `docs:check` with counts `100/28/205/19/17/3`, focused root-export/
package API tests (`6` files / `69` tests), exact-path formatting, equal-status,
scope/import/future-policy lint, conflict scan, and diff-whitespace checks. The
future-policy scan's two contextual hits describe current lifecycle state and
do not promise future policy. Independent reviewer round 1 may now be assigned;
no reviewer result has yet been accepted.

## Independent Review Round 1 Assignment

- Immutable package range: `0868ecca..fcef6d35`.
- Style/maintainability: existing role, explicit `gpt-5.6-terra` / high.
- Documentation completeness: existing role, explicit
  `gpt-5.6-luna` / medium.
- TypeScript/API docs: existing role, explicit `gpt-5.6-terra` / high.
- Performance/reliability: existing role, explicit
  `gpt-5.6-terra` / high.
- Reviewers are read-only, receive only their distinct concern, cannot spawn
  subagents, and must ignore historical superseded text unless current task
  records or changed public docs claim it as active. The complete wave must be
  collected before findings are deduplicated or returned to implementation.
- Security is deferred to T-0041 by protocol.

## Independent Review Round 1 Results

- Documentation completeness (`gpt-5.6-luna` / medium): clean.
- TypeScript/API docs (`gpt-5.6-terra` / high): clean.
- Performance/reliability (`gpt-5.6-terra` / high): clean.
- Style/maintainability (`gpt-5.6-terra` / high): two actionable findings:
  1. P1, `README.md`: remove or narrow the false initial-release exclusion for
     semantic-tag consumption already implemented by D-0069 routing.
  2. P2, `packages/server/README.md`: merge adjacent duplicate production
     exclusion lists while preserving unique scheduler/backoff and no-future-
     policy wording.
- The orchestrator collected the complete wave before adjudication and closed
  every reviewer. The Desktop runtime exposes immutable role model/reasoning
  metadata matching all explicit spawn fields; child-local inability to inspect
  that metadata does not conflict with the orchestrator-facing runtime record.
- Both findings are technically accepted and assigned together to the existing
  implementer (`gpt-5.6-terra` / medium), docs/records only, no subagents.

## Review Round 1 Fix Handback

- P1 fixed in `README.md`: implemented descriptor-derived semantic-tag routing
  consumption is no longer called a release exclusion; the remaining wording
  is limited to application-owned registration/materialization.
- P2 fixed in `packages/server/README.md`: the duplicate adjacent production
  lists are one statement retaining delivery/retry policy, monitors/workers,
  backoff/scheduler ownership, topology, supervision, catch-up, adapters, and
  no future-policy commitment.
- Author checks passed: exact-path Prettier, focused wording/duplicate/status
  scans, `git diff --check`, and `pnpm docs:check` with expected export counts
  `100/28/205/19/17/3`.
- No reviewer is active. Coordinator focused verification remains pending
  before any rereview disposition.

## Coordinator Verification After Review Round 1

Both accepted findings are resolved in the current diff. Coordinator evidence:
`docs:check` counts `100/28/205/19/17/3`; exact-path Prettier; focused
semantic-tag, duplicate-exclusion, future-policy, and equal-status scans;
conflict scan; and current/baseline `git diff --check`. No reviewer is active.
The fixes may proceed to a fresh four-concern review wave; security remains
deferred to T-0041 and full verify remains the final task gate.

## Independent Review Round 2 Assignment

- Immutable package range: `0868ecca..769176d4`.
- Style/maintainability: existing role, explicit `gpt-5.6-terra` / high.
- Documentation completeness: existing role, explicit
  `gpt-5.6-luna` / medium.
- TypeScript/API docs: existing role, explicit `gpt-5.6-terra` / high.
- Performance/reliability: existing role, explicit
  `gpt-5.6-terra` / high.
- Every reviewer is read-only, cannot spawn subagents, receives one concern,
  and ignores superseded historical text unless current records or changed docs
  activate it. Collect the complete wave before adjudication. Security remains
  deferred to T-0041.

## Independent Review Round 2 Results

- Style/maintainability (`gpt-5.6-terra` / high): clean.
- Documentation (`gpt-5.6-luna` / medium) and TypeScript/API docs
  (`gpt-5.6-terra` / high): same P2, deduplicated. The testing README fixture
  examples omit consumer-generated schema imports and leave setup values
  undeclared.
- Performance/reliability (`gpt-5.6-terra` / high): P2. The server README
  incorrectly says the environment owns selected facilities; production
  facilities default caller-owned unless their individual `owns*` flags are
  true, independently of server-level `ownsEnvironment`.
- All explicit dispatch fields matched immutable Desktop runtime role metadata,
  and every reviewer is closed. The complete wave yields two accepted fixes,
  assigned together to the existing implementer (`gpt-5.6-terra` / medium),
  docs/records only, no subagents. Security remains deferred to T-0041.

## Review Round 2 Fix Handback

- Deduplicated fixture finding fixed in `packages/testing/README.md`: consumer
  schemas are imported from an identified illustrative generated package, and
  `BoundedContext` plus repository/topic/query/command setup are explicit with
  no undeclared values.
- Reliability finding fixed in `packages/server/README.md`: selection is
  separate from per-facility ownership, all four production `owns*` flags are
  named with their false defaults, and `ServerOptions.ownsEnvironment` is
  separately defined as closure of the environment object after dependencies.
- No reviewer is active. Coordinator focused verification remains pending.
- Implementer evidence passed: exact-path Prettier for the two corrected
  READMEs and all three records; focused package-only import, declaration,
  stale ownership, future-policy, identical-status, and prohibited-scope
  scans; `git diff --check`; and `pnpm docs:check` with TypeDoc export counts
  `100/28/205/19/17/3` for proto/core/server/storage/transport/testing.
- Full `pnpm verify` remains deliberately deferred to the final task gate.

## Coordinator Verification After Review Round 2

The coordinator independently accepted both fixes. Evidence: multiline
import-block validation for every formerly undeclared testing symbol; public
source/TSDoc comparison for per-facility and server-level ownership;
`docs:check` counts `100/28/205/19/17/3`; exact-path Prettier; equal-status,
stale-ownership, conflict, scope, and current/baseline diff checks. No reviewer
is active. A fresh four-concern wave is required; security remains deferred to
T-0041 and full verify remains final-only.

## Independent Review Round 3 Assignment

- Immutable package range: `0868ecca..716aba30`.
- Style/maintainability: `gpt-5.6-terra` / high.
- Documentation completeness: `gpt-5.6-luna` / medium.
- TypeScript/API docs: `gpt-5.6-terra` / high.
- Performance/reliability: `gpt-5.6-terra` / high.
- Explicit dispatch, read-only, no subagents, distinct concerns, superseded
  historical text ignored unless current records/docs activate it. Recheck both
  round 2 fixes and collect the full wave before adjudication. Security remains
  deferred to T-0041.

## Independent Review Round 3 Results

- Style/maintainability (`gpt-5.6-terra` / high): clean.
- Documentation completeness (`gpt-5.6-luna` / medium): clean.
- Performance/reliability (`gpt-5.6-terra` / high): clean.
- TypeScript/API docs (`gpt-5.6-terra` / high): four accepted P2 findings:
  undeclared caller-owned inputs in the core envelope-helper fence; undeclared
  or implicit fixture inputs across active server fences; undocumented
  generated-artifact-only
  `@spine-ts/server/internal/generated-handler-registry`; and stale “open
  production gaps” wording for release exclusions.
- The complete wave was collected before adjudication, every explicit profile
  matched immutable Desktop runtime metadata, and every reviewer is closed.
  Assign all four docs-only fixes together to the existing implementer
  (`gpt-5.6-terra` / medium), no subagents. Security remains T-0041.

## Review Round 3 Fix Handback

- Core envelope-helper input finding fixed by explicitly marking the call-shape
  fragment non-executable and naming all eight caller-owned inputs.
- Server fixture finding fixed across the dispatcher/envelope, stand,
  lifecycle/environment, entity-state, and transition fences with public
  package-only type imports and explicit fixture declarations.
- Internal-subpath finding fixed narrowly in the server package README and API
  overview; it remains generated-artifact-only/package-internal and absent from
  root and TypeDoc guidance.
- Future-policy finding fixed with initial-release exclusion wording and no
  future commitment. No reviewer is active; coordinator verification is
  pending.
- Implementer evidence passed: assigned-fence identifier and package-import
  scans, narrow internal-subpath and future-policy scans, identical statuses,
  exact-path Prettier, prohibited-scope scan, and `git diff --check`.
- `pnpm docs:check` verified 25 copied proto checksums and TypeDoc export counts
  `100/28/205/19/17/3`; full `pnpm verify` remains final-only.

## Coordinator Verification After Review Round 3

All four fixes are independently accepted. Evidence: public type/Stand/export/
writer inspection; `docs:check` counts `100/28/205/19/17/3`; focused server
tests `2` files / `31` tests; exact-path Prettier; fixture-input,
internal-subpath, corrected future-policy, equal-status, scope, conflict, and
current/baseline diff checks. No reviewer is active. Fresh four-concern review
is required; security remains T-0041 and full verify remains final-only.

## Independent Review Round 4 Assignment

- Immutable package range: `0868ecca..f67c55b1`.
- Style, TypeScript/API docs, performance/reliability: explicit
  `gpt-5.6-terra` / high; documentation: explicit `gpt-5.6-luna` / medium.
- Read-only, one distinct concern, no subagents; ignore superseded history
  unless current records/docs activate it. Recheck all round 3 fixes and collect
  the complete wave before adjudication. Security remains T-0041.
