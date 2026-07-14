# T-0039b Review Log

Status: Review round 1 fixes verified — round 2 assignment pending

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
