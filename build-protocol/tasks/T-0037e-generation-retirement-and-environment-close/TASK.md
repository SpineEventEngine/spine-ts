# T-0037e: Generation Retirement And Environment Close

Status: Superseded split parent; do not implement

Dependency: T-0037d complete and integrated.

## Audit Purpose

Round 15 found this child too large for one implementation and review package.
Its active requirements moved exactly once into three independently sequenced
Candidate/not-started children:

1. `T-0037e1 Registration Detach Lifecycle`
2. `T-0037e2 Reusable Generation Stop`
3. `T-0037e3 Permanent Environment Close`

This file is a durable split-parent record only. It owns no implementation,
branch, work log, review log, runtime behavior, public API, or documentation
change and must not be started. The active implementation sequence is
`T-0037a`, `T-0037b`, `T-0037c`, `T-0037d`, `T-0037e1`, `T-0037e2`,
`T-0037e3`, then `T-0037f`.

## Ownership Map

- T-0037e1 owns non-last registration-scoped detach/retry, ordinary last-
  detach retirement/retry, safe retired-slot clearing, later first-attach fresh
  generation, and detach/attach races.
- T-0037e2 owns the sole package-internal reusable generation-stop operation,
  its transition owner and sole fresh candidate, registration/readiness-route
  rebind, canonical-scope transfer, publication, admission reopen, error and
  partial-progress retry, and racing-attach join behavior.
- T-0037e3 owns live-registration close refusal, zero-registration permanent
  close/retry, close/attach races, safe slot clearing, and owned-facility
  teardown.
- T-0037f depends on T-0037e3 and owns server lifecycle integration.

The six deterministic generation-ending same-operation retry owners remain
unchanged: caller-owned failed-start rollback in T-0037d; ordinary last detach
in T-0037e1; reusable explicit stop in T-0037e2; zero-registration permanent
close in T-0037e3; and server-owned startup cleanup plus caller-owned server
cleanup in T-0037f. Non-last detach in T-0037e1 remains a separate non-retiring
registration-scoped retry.

## Historical Boundary

Earlier review records that name T-0037e describe the then-active combined
brief and remain historical evidence. Current implementation and review must
use T-0037e1/e2/e3 and D-0086. No child work or review log is created until
that child starts.
