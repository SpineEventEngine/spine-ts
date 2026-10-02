# Registry read correction: implementation evidence

The earlier retry work below remains part of the implementation, but it did
not solve the core publication failure. The current implemented behavior is recorded
under **Publication and visibility correction** below.

2026-10-02, `fix-release-registry-reads` checkout. Bounded implementation role, Sol/medium; no commits, pushes, external publication calls, or subagents in this assignment.

## Red and green

- Added a preflight test with a `200` response whose JSON body never settles. Before the production change, `pnpm exec vitest run scripts/release-registry.test.mjs --maxWorkers=1` failed at `registry read timed out for @synthetic/base` (1 failed, 4 passed).
- Added an aborting request fixture. Before correcting the timer race, the same focused test rejected with `AbortError` instead of retrying (1 failed, 8 passed).
- After correction, `pnpm exec vitest run scripts/release-registry.test.mjs scripts/release-publication.test.mjs scripts/release-cli.test.mjs scripts/release-trial.test.mjs --maxWorkers=1` passed (67 tests in four files). Targeted ESLint, Prettier, and `git diff --check` also passed.

## Behavior and bounds

- Both release preflight and publication use `release-get.mjs` for GET only. Each attempt covers headers and JSON body, with a 10,000 ms maximum. There are at most three attempts and delays of at most 50 and 100 ms. Without a shorter caller deadline, one resource therefore takes at most 30,150 ms plus scheduling overhead. Confirmation passes its remaining shared 60,000 ms window as the total limit for each read; the window is not renewed per package.
- A transport `TypeError`, explicit timeout, HTTP 429, and HTTP 5xx are temporary. An exhausted temporary read throws `TemporaryRegistryError`; it never becomes a 404, success, or upload permission. Explicit 404 alone establishes absence. HTTP 401 and other non-retryable statuses, malformed JSON/schema, hash/tag/provenance contradictions, and unrelated exceptions remain fatal. The timeout settles its temporary error before aborting the request so the resulting `AbortError` cannot win the race.
- Explicit read-only verification saves a temporary failure as unconfirmed, revisits it while the shared window remains, and does no npm upload. Existing upload attempt records and the two-attempt Rekor exception remain in place.
- The guarded regular CI trial now invokes real release entrypoints with a stalled response body that recovers, plus denied and malformed preflight responses. It verifies all 19 expected upload calls in the recovery case and zero upload calls for fatal preflight errors. Its global fetch and subprocess guards remain active.

## Files and limits

Changed `scripts/release-get.mjs`, `release-registry.mjs`, `release-publication.mjs`, `release-trial.mjs`, their focused tests, and `docs/release-publishing.md`. One synthetic package-order test now uses its own snapshot.20 fixture consistently while workspace manifests are aligned separately. No version or lockfile edits belong to this implementation.

No prepared release directory exists in this checkout, so the full archive-backed `runTrial` was not run locally. The trial code and fault boundary have focused tests; the orchestrator's release verification and future PR CI must execute the complete offline trial. The original CI report artifact was unavailable, so this correction does not claim which phase made the original failed read.

## Mechanical correction before review

Reflowed the trial log and release guide, and completed TSDoc for the GET helper, trial service fault parameter, trial command helper, and read-failure trial. Production behavior did not change. The main agent reported a successful tooling typecheck, 42 policy/publish-new-package/Todo startup tests, and a real loopback stalled-body recovery in two GETs; those checks were not rerun here.

This implementation assignment ran and passed:

- `pnpm lint:cleanup`
- `pnpm lint:tsdoc`
- `pnpm docs:audience:check`
- Scoped ESLint and Prettier checks for the changed release scripts, tests, guide, and this record
- Four focused release test files with `--maxWorkers=1`: 67 tests passed

## Publication and visibility correction

The human clarified that npm can accept an upload before public registry reads
expose its version, for an unknown duration. I added red-first tests for an npm
exit 0 with only 404 and old tags, an immediate rerun with the accepted package
still invisible, and contradictory accepted evidence. Before this correction,
the two focused files had four failing tests: the CLI publication test waited
for public confirmation, accepted uploads remained `unconfirmed`, the rerun
rejected a valid invisible accepted upload, and a contradictory report reached
registry reads. A further red test showed a prior `already present` record
could incorrectly authorize an upload after its version disappeared.

The writing command now marks npm exit 0 as `published` in the durable report
and returns without post-upload registry confirmation. `verify-registry` alone
checks public visibility and may report it unconfirmed without reversing the
accepted upload. On an immediate rerun, a matching prior accepted attempt with
`diagnostics.exitCode === 0` is skipped without a registry read. The validator
checks accepted attempt order and status before any read or write. Remaining
packages retain exact-version, tag, hash, provenance, and uncertain-outcome
rules. A previously visible version that now reads as missing cannot authorize
another upload. The narrow pre-upload Rekor exception remains.

The guarded offline trial now includes all 19 accepted uploads with every new
version still 404 and old tags, with an exact count showing no post-upload GET.
Its partial rerun skips the first two accepted uploads while still invisible.
The delayed-body scenario runs through explicit read-only verification; denied
and malformed preflight responses remain fatal. The trial continues to block
unapproved fetch and subprocess calls. The archive-backed trial was not run
locally because this checkout has no prepared release directory; the main
release gate will exercise it.

Final focused verification after the last correction: four release test files,
`--maxWorkers=1`, passed 74 tests. `pnpm typecheck:tooling`,
`pnpm lint:cleanup`, `pnpm lint:tsdoc`, `pnpm docs:audience:check`, scoped ESLint,
scoped Prettier, and `git diff --check` passed.

## Independent reliability review corrections

The accepted P1 and P2 findings were fixed as one batch. Red-first tests showed
that a false saved `pre-upload-conflict` reached a registry read and that a
confirmed package was reread while another package was pending (two expected
failures in the focused publication file). Prior write validation now requires
every saved conflict attempt to have an integer nonzero npm exit code and
diagnostics that pass the existing exact `isRekorConflict` matcher. Invalid
evidence stops before registry reads or npm writes. A genuine saved conflict
still permits the one remaining bounded attempt; uncertain outcomes remain
blocked from resending.

Each `confirmPrepared` call now tracks only confirmations it gathered itself.
It revisits pending entries and retains completed confirmations through later
temporary read failures. Initial `published` or `accepted` report fields still
receive a fresh public read during explicit verification. The release guide
describes these rules.

After the correction, the four focused release files passed 77 tests with
`--maxWorkers=1`. `pnpm typecheck:tooling`, `pnpm lint:cleanup`,
`pnpm lint:tsdoc`, `pnpm docs:audience:check`, scoped ESLint and Prettier,
and `git diff --check` passed. No full suite, archive-backed trial, publication
call, commit, push, or remote mutation was performed in this assignment.
