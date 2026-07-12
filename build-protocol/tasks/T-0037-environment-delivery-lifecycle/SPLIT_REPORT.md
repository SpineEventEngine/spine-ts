# T-0037 Split Report

Status: Committed; required review pending

Baseline: `ab8fc9f4`

## Result

D-0085's environment lifecycle successor is too broad for one implementation
and review package. D-0086 sequences it without changing its semantics:

| Order | Child | Exclusive invariant ownership |
| --- | --- | --- |
| 1 | T-0037a | Built-context delivery descriptor, actual storage, tenants, endpoints/shards, post-persist readiness |
| 2 | T-0037b | Serialized/coalesced finite T-0036 starts and per-shard disposition handling |
| 3 | T-0037c | Finite canonical parked obligations and one-time cause reporting |
| 4 | T-0037d | Environment registrations, startup recovery, attribution, failed-start rollback |
| 5 | T-0037e | Detach, stop/retire/reuse, close refusal, permanent environment close |
| 6 | T-0037f | Listener startup and network/context/resource/facility shutdown ordering |

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
actual storage factory, tenant scopes, and notification-after-persist ordering.
It must preserve the current immediate exact drain and must not start a worker
or attach an environment registration.

## Verification

`pnpm docs:check` passed after the standard fresh-worktree generated declaration
build, with zero errors and only the known invalid-`origin` warning.
`pnpm format:check`, `git diff --check`, tracked scope, untracked scope, and
child-artifact checks passed. Full `pnpm verify` was intentionally not run for
this docs-only inner loop. No required review lane is claimed.
