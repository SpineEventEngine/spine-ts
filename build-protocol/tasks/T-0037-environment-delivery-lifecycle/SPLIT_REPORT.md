# T-0037 Split Report

Status: Round 6 docs fix active

Baseline: `ab8fc9f4`

## Result

D-0085's environment lifecycle successor is too broad for one implementation
and review package. D-0086 sequences it without changing its semantics:

| Order | Child   | Exclusive invariant ownership                                                               |
| ----- | ------- | ------------------------------------------------------------------------------------------- |
| 1     | T-0037a | Descriptor/storage/tenants/endpoints and synchronous non-throwing per-row readiness         |
| 2     | T-0037b | Finite starts, tenant-aware lossless merge, dispositions, finally-safe retirement primitive |
| 3     | T-0037c | Finite canonical parked obligations and one-time cause reporting                            |
| 4     | T-0037d | Registrations/startup, lossless transition readiness barrier, failed-start rollback         |
| 5     | T-0037e | Detach, explicit stop, surviving-scope rebind/fresh-generation race, permanent close        |
| 6     | T-0037f | Listener startup and network/context/resource/facility shutdown ordering                    |

Every child is Candidate/not started and depends on its predecessor. Each will
receive its own branch, work/review records, TDD cycle, focused checks, and four
review lanes only when started.

T-0037d's transition barrier gives persistence after direct-drain admission
closes but before readiness routing is installed a bounded canonical-scope
buffer, then transfers each scope exactly once before startup admission.
T-0037e's reusable explicit stop rebinds every surviving registration,
readiness route, and configured/startup scope to exactly one fresh generation;
an eligible racing attach joins it without old/new overlap.

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

The verified Round 1 fix was committed as `3847e1b6`; reconciliation through
`80ef21e2` formed the Round 2 review boundary. Round 2 fixes were committed as
`7281ba07`. Round 3 reviewed package `0308bc4a..49b3fb4b`; its accepted docs
fixes were committed as `97107fae` after worker and coordinator verification.
Round 4 review completed with accepted findings. Its docs fix passed worker and
coordinator verification, was committed as `98b4a284`, and was reconciled
through `1b127f87`. Round 5 completed all four lanes with one stale-status
finding in the active parent summaries. That finding's docs fix is authored and
awaits focused verification; no clean review is claimed.

## Verification

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
fresh review remains pending and no clean review is claimed.
