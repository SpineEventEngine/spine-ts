# T-0037 Split Report

Status: Round 2 docs fix active

Baseline: `ab8fc9f4`

## Result

D-0085's environment lifecycle successor is too broad for one implementation
and review package. D-0086 sequences it without changing its semantics:

| Order | Child   | Exclusive invariant ownership                                                                   |
| ----- | ------- | ----------------------------------------------------------------------------------------------- |
| 1     | T-0037a | Descriptor, actual storage, tenants, endpoint/shards, per-successful-row readiness              |
| 2     | T-0037b | Finite starts, bounded lossless scope merge, dispositions, reusable stop/await/retire primitive |
| 3     | T-0037c | Finite canonical parked obligations and one-time cause reporting                                |
| 4     | T-0037d | Registrations/startup, failed-start primitive invocation, empty-generation slot replacement     |
| 5     | T-0037e | Ordinary detach/close invocation, fresh-generation races, close refusal, permanent close        |
| 6     | T-0037f | Listener startup and network/context/resource/facility shutdown ordering                        |

Every child is Candidate/not started and depends on its predecessor. Each will
receive its own branch, work/review records, TDD cycle, focused checks, and four
review lanes only when started.

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

The reviewed package boundary is `9e90a006`; the current docs-fix assignment is
recorded by `652db999`. This uncommitted fix package makes no review claim and
names no future fix hash.

## Verification

`pnpm docs:check` passed after the standard fresh-worktree ignored-declaration
bootstrap, with zero errors and only the known invalid-`origin` warning.
`pnpm format:check`, `git diff --check`, tracked scope, untracked scope, and
child-artifact checks passed for the original split package. Full `pnpm verify`
was intentionally not run for that docs-only inner loop. Round 1 produced
accepted findings. The complete fix package then passed fresh `docs:check`,
`format:check`, `git diff --check`, exact tracked/untracked scope, and
child-artifact checks with unchanged 205 server exports and only the known
invalid-`origin` warning. Full `pnpm verify` remains reserved. No fresh review
is claimed.
