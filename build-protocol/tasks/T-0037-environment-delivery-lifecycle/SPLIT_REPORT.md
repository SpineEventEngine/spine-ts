# T-0037 Split Report

Status: Round 16 docs fix worker active

Derived status mirror: the canonical current state is the `Status` header in
`TASK.md`; timestamped Events are audit detail, not competing authority.

Baseline: `ab8fc9f4`

## Result

D-0085's environment lifecycle successor is too broad for one implementation
and review package. D-0086 sequences it without changing its semantics:

| Order | Child    | Exclusive invariant ownership                                                               |
| ----- | -------- | ------------------------------------------------------------------------------------------- |
| 1     | T-0037a  | Descriptor/storage/tenants/endpoints and synchronous non-throwing per-row readiness         |
| 2     | T-0037b  | Finite starts, tenant-aware lossless merge, dispositions, finally-safe retirement primitive |
| 3     | T-0037c  | Finite canonical parked obligations and one-time cause reporting                            |
| 4     | T-0037d  | Registrations/startup, lossless transition readiness barrier, failed-start rollback         |
| 5     | T-0037e1 | Registration detach, last-detach retirement/retry, later fresh attach                       |
| 6     | T-0037e2 | Reusable stop, route rebind, scope transfer, publication, admission reopen                  |
| 7     | T-0037e3 | Live-registration refusal, permanent close/retry, slot clear, facility teardown             |
| 8     | T-0037f  | Listener startup and network/context/resource/facility shutdown ordering                    |

Every active child is Candidate/not started and depends on its predecessor. The
former T-0037e is a superseded split-parent audit record and must not be
implemented. Each active child will
receive its own branch, work/review records, TDD cycle, focused checks, and four
review lanes only when started.

The six deterministic same-operation generation-retirement retries are owned
separately: caller-owned failed-start rollback by T-0037d; ordinary last detach
by T-0037e1; reusable explicit stop by T-0037e2; zero-registration permanent
close by T-0037e3; and
server-owned startup cleanup plus caller-owned server cleanup by T-0037f.
Non-last detach is a separate non-retiring registration-scoped retry; it cannot
stop or retire the shared generation or clear its slot.

T-0037d's transition barrier gives persistence after direct-drain admission
closes but before readiness routing is installed a bounded canonical-scope
buffer, then transfers each scope exactly once before startup admission.
T-0037e2's reusable explicit stop constructs the sole fresh candidate itself even
when no attach races, then rebinds every surviving registration and readiness
route to exactly one fresh generation. It transfers every configured, startup,
buffered, and retained canonical scope exactly once into fresh pending admission,
publishes the candidate, and reopens admission before propagating the result of
close-admission/stop, await quiescence,
classify, consume/report, then permanent-retirement/cleanup. The old instance's
stopped and quiescent state is fail-closed even if reporting or cleanup fails. A
bounded canonical-scope bridge owns readiness through the fresh recovery
snapshot and route rebind, transferring all canonical scopes losslessly and
exactly once before publication and later-write admission. Rebind and transfer
use distinct per-unit checkpoints. Transition construction/rebind/
transfer failure publishes no partial generation, keeps admission closed, and
retains bounded scopes for one later external retry without self-looping. Once
constructed, the sole unpublished candidate remains owned by that transition;
rebind/transfer failure waits for admitted candidate work to settle, and retry
resumes that same candidate rather than constructing another. An eligible racing
attach waits for and joins that transition-owned generation without old/new
overlap.
If reusable explicit stop cannot establish quiescence, it retains the unsafe
generation, live registrations, transition readiness owner, and endpoint
dependencies; explicit retry resumes the same stop and completes retirement,
rebind, retained-scope transfer, publication, and admission reopen exactly once.
T-0037e1 separately owns non-last and ordinary last detach. If T-0037e3 zero-
registration permanent close cannot establish quiescence, it retains
the unsafe slot and facilities with close still in progress; retry completes
retirement, safe slot clearing, and owned-facility teardown exactly once and
remains permanently closed. T-0037f separately resumes a caller-owned failed-
start rollback through deferred server cleanup without closing the shared
environment, then proves one later fresh server attachment without overlap.

## Grounding Facts

Today environment delivery is only an optional closeable. Built-context
handoffs construct tenant-specific `Delivery` values and exact-drain just after
durable receive. Built contexts retain their actual storage factory; tenant
indexes can enumerate recorded tenants, but startup does not. Server close is a
flat network-then-closeables sequence. T-0036 evidence remains exactly as
verified and explicitly invoked.

JVM evidence contributes only environment ownership and post-persist
readiness. Singleton state, threads, repeat callbacks, public monitor actions,
catch-up stations, and global storage copying are rejected.

## Handoff

After parent review/integration, create only T-0037a's implementation branch
and durable logs. Its first RED tests must pin the built-context descriptor,
actual storage factory, tenant scopes, and readiness after every successful row
persistence, including earlier rows in a partially failed `receiveAll` flow and
none for a rejected write. It must preserve the current immediate exact drain
and must not start a worker or attach an environment registration.

## Historical Review Summary Through Round 11 (`34f8f5e4`)

The verified Round 1 fix was committed as `3847e1b6`; reconciliation through
`80ef21e2` formed the Round 2 review boundary. Round 2 fixes were committed as
`7281ba07`. Round 3 reviewed package `0308bc4a..49b3fb4b`; its accepted docs
fixes were committed as `97107fae` after worker and coordinator verification.
Round 4 review completed with accepted findings. Its docs fix passed worker and
coordinator verification, was committed as `98b4a284`, and was reconciled
through `1b127f87`. Round 5 completed all four lanes with one stale-status
finding in the active parent summaries. That finding's docs fix passed worker
and coordinator verification, was committed as `96c27f11`, and was reconciled
through `a8c2f3c5`. Round 6 completed all four lanes with accepted docs findings
and its verified fix formed reviewed package `0308bc4a..045aa86c`. Round 7
accepted the reusable-stop readiness bridge, finally-equivalent survivor
rebind, and fixed-package ledger findings. The Round 7 fix passed worker and
coordinator verification and was committed as `628224d4`. Round 8 completed all
four lanes with the dedicated retirement-failure TDD and this stale active-
summary correction as its two-item finding; that docs fix passed worker and
coordinator verification. Round 9 accepted the connected fail-closed retirement,
non-empty failure-buffer, failed-start retired-slot, and retryable transition-
failure batch. Its docs fix passed worker and coordinator verification and was
committed as `ee6fb396`. Round 10 accepted the quiescence-failure endpoint-
retention boundary, ordinary last-detach safe slot clearing, fresh-transition
error qualification, this stale handoff correction, and work-log chronology.
The Round 10 worker and coordinator verification passed, and the fix was
committed as `724e384d`. Round 11 accepted the retained fresh-candidate
ownership, successful quiescence-retry, active-summary, and participant-ordering
findings. The Round 11 docs fix later passed worker and coordinator verification
and was committed as `34f8f5e4`.

## Historical Verification Through Round 11 (`34f8f5e4`)

`pnpm docs:check` passed after the standard fresh-worktree ignored-declaration
bootstrap, with zero errors and only the known invalid-`origin` warning.
`pnpm format:check`, `git diff --check`, tracked scope, untracked scope, and
child-artifact checks passed for the original split package. Full `pnpm verify`
was intentionally not run for that docs-only inner loop. Round 1 produced
accepted findings. The complete fix package then passed fresh `docs:check`,
`format:check`, `git diff --check`, exact tracked/untracked scope, and
child-artifact checks with unchanged 205 server exports and only the known
invalid-`origin` warning. Full `pnpm verify` remains reserved. Round 2 reviewed
the reconciled `80ef21e2` boundary and its accepted fixes passed the checks
below.

The Round 2 docs fix passed fresh docs/status lint, `docs:check`,
`format:check`, `git diff --check`, exact eleven-file scope, no-untracked, and
child-only-brief checks. TypeDoc retained 205 expected server exports and only
the known invalid-`origin` warning. Fresh review remains pending.

Round 3 reviewed package `0308bc4a..49b3fb4b`. Its accepted four-item docs fix
passed worker and coordinator verification. Round 4 completed all four lanes
with accepted findings; its fix passed worker and coordinator verification,
was committed as `98b4a284`, and was reconciled through `1b127f87`. Round 5
completed all four lanes with one stale-status finding in the active parent
summaries. That finding's docs fix passed worker and coordinator verification;
it was committed as `96c27f11` and reconciled through `a8c2f3c5`. Round 6
completed all four lanes with accepted docs findings and its verified fix formed
reviewed package `0308bc4a..045aa86c`. Round 7 accepted findings; its docs fix
passed worker and coordinator verification and was committed as `628224d4`.
Round 8 completed all four lanes with a two-item finding: add the dedicated
post-consumption permanent-retirement-failure TDD case and correct this stale
active verification summary. The Round 8 docs fix passed worker and coordinator
verification. Round 9's connected failure-state docs fix passed worker and
coordinator verification and was committed as `ee6fb396`. The Round 10 worker
and coordinator verification passed, and the fix was committed as `724e384d`.
Round 11 accepted the retained fresh-candidate ownership, successful quiescence-
retry, active-summary, and participant-ordering findings. The Round 11 docs fix
later passed worker and coordinator verification and was committed as
`34f8f5e4`.

For current orchestration, use the parent T-0037 `TASK.md` `Status` header. This
report's header is only its derived mirror; timestamped work/review Events are
audit detail. Historical summaries above never state current pending work.
