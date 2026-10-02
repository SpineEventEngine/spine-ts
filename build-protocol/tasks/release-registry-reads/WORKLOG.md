# Work log

Started 2026-10-02. Branch `fix-release-registry-reads`, existing checkout
`/Users/armiol/.codex/worktrees/cross-context-queries/spine-ts`.

- Read the supplied publication logs and current release code. The failure was
  an uncaught registry-read timeout, not a build or npm upload error.
- Updated local master to `881931d0f` and started the feature branch there.
- Public read-only checks found all 19 snapshot.20 packages and no snapshot.21
  packages. The delivery-client provenance identifies the failed workflow.
  GitHub's saved report is inaccessible with available credentials; original
  read phase and the reason for the delayed response remain unknown.
- Pushed version-only commit `53effe619` immediately. All 31 manifests use
  snapshot.21; pins, lockfile and version-sensitive fixtures are separate edits.
- Frozen offline installation passed. Focused implementation and test evidence
  will be recorded in `IMPLEMENTATION.md` before independent review.
- Main coordinates records and versions. One implementer changes release code;
  explicit profile/session records are in `TASK.md`. No questions need a human
  decision; no publication, workflow rerun or pull request creation is allowed.

## Verification choice

Use the full `verify:release` profile once after review because release tooling
changed. Run focused release tests, tooling typecheck, scoped lint, formatting,
documentation checks and diff check first. Scripts are not in the runtime
coverage denominator; inspect and test their changed branches directly.
The human-created PR #16 is now available, so its exact-head CI runs the full
profile and preparation of all 19 archives followed by the fresh-job guarded
offline trial. Do not duplicate the expensive full profile locally. The trial
must make no real npm/Sigstore publication calls.

## Planned review assignments

Each reviewer gets a fresh session without conversation history or memory and
cannot edit source or delegate. Explicit model/reasoning flags and Standard
speed are required. Record actual session IDs on completion; the CLI exposes
configured profiles but not independent runtime model introspection.

- Existing performance/reliability reviewer: Sol/medium. Review bounded GET
  recovery, deadlines, cancellation, saved reports and prevention of duplicate
  upload; verify regressions reproduce asynchronous failure behavior.
- Existing style/maintainability reviewer: Sol/medium. Review changed scripts
  and focused tests for concrete structure, naming and maintainability defects.
- Existing documentation reviewer: Luna/medium. Check affected release guide
  claims and function documentation against actual limits and behavior.
- TypeScript/public API review: N/A. No framework declarations, public package
  APIs, Protobuf contracts or application snippets change.
- Final release-readiness security review: Sol/high after convergence. Check
  that retries cannot bypass metadata, integrity, provenance, selected-tag or
  trial-isolation checks. Keep review limited to the changed release path.

Collect the complete review wave before returning one accepted correction
batch to the same implementation session. Run targeted re-review only for
substantively changed concerns.

## Implementation and initial checks

The implementer completed its first pass with 67 passing release tests and
recorded two expected failures before correction: a stalled response body and
a timeout/cancellation race. Main separately ran 42 version-policy,
first-publication and Todo startup tests successfully, plus tooling typecheck
and documentation audience checks. A real loopback HTTP server sent headers
and an incomplete body on the first GET; the actual fetch reader recovered on
the second GET within its configured bound.

Cleanup and TSDoc checks caught one long log line and missing parameter
descriptions. Returned these mechanical findings as one batch to the same
Sol/medium implementation session, with the same explicit flags. Independent
review and the expensive verification profile wait for those checks to pass.

## Correct the success condition after human feedback

The mechanical batch passed: cleanup, TSDoc, documentation audience, scoped
ESLint/format and 67 focused tests. No runtime implementation is accepted yet.
The user then clarified that npm publication is not immediately publicly
readable and has no known visibility deadline. Main traced the code and
recorded the revised success/recovery design in `TASK.md`; read retries alone
are insufficient. The receiving-code-review skill was used to check the
feedback against the actual implementation before changing that design.

Fresh independent plan review `01a0fc27-a87b-7de0-b643-696560497a8d`, explicit
Sol/medium, Standard, memory and delegation disabled, completed. It agrees
with accepting npm exit0 without immediate public confirmation. One accepted
P1 clarification: validate saved accepted attempt semantics, including zero
exit code and consistent order/status, before skipping it during a rerun.
Identity/hash checks alone are insufficient. Added that requirement to the
plan and returned the revised scope to the same implementation session.

Both all-dependency and production-dependency security audits passed with no
known vulnerabilities. PR #16 was discovered and attached; only the version
commit is pushed so far. Its current head does not yet contain the fix, so it
is not acceptance evidence for this task. Verify the final pushed commit.

The same Sol/medium implementation session completed the revised publication
and recovery paths. It reported 74 passing focused tests and clean tooling,
cleanup, TSDoc, documentation audience, scoped lint/format and diff checks.
The implementation record distinguishes the initial retry-only correction
from the corrected publication success condition. Main checked current claims,
changed file scope and exported helpers: no framework API changes or new
public package dependencies. Actual archive-backed trial and full verification
remain pending exact-head PR CI, not claimed by the focused evidence.

Dispatch the planned three independent review concerns now. Each gets the
working diff against `881931d0f`, including the untracked GET helper, and the
current human clarification; no chat history or memory. No code writer is
active while this review wave runs. Collect all findings before fixes.

## Review convergence and integration

The independent wave found one report-validation defect and one read-only
verification defect. Both were reproduced before correction and returned as
one batch to the same implementer. The fresh reliability re-review and final
security review are clean; profile/session records and findings are in
`REVIEW.md`. All child sessions have exited. No unresolved code findings remain.

The final bounded verification passed 138 tests in nine files, the pinned
Node24.18.0/npm11.16.0 local Rekor reproduction, and release readiness
(87 package imports, 54 assets, 423 relative Markdown links). The complete
output is in `/tmp/release-final-mechanical.log`; the durable result is here.
Tooling typecheck, cleanup, TSDoc, documentation audience, scoped ESLint/format,
frozen install and both dependency audits have also passed.

Ready to commit and immediately push the corrected scripts, tests, guide,
version references and evidence. The prior version-only commit is already
pushed. Do not create a follow-up record-only commit to name this integration
commit; the branch history and PR checks identify it. The remaining acceptance
step is the full release verification plus archive-backed offline trial for
the exact pushed commit in PR #16. Local focused checks are not substituted
for that result. No actual package publication is authorized in this task.
