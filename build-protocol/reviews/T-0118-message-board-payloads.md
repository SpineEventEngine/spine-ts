# T-0118 Review Log

Status: Correction batch implemented; targeted re-review pending

## Scope

Reviews only Message Board payload-first application, authoritative recovery,
race/coalescing behavior, logging, and focused browser/example integration.

## Planned Dispositions

| Concern                 | Existing role/profile   | Status                                                                                                                    |
| ----------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Style/maintainability   | `gpt-5.6-terra` / high  | Two findings accepted: raw response logging and duplicate row ordering.                                                   |
| Documentation           | `gpt-5.6-luna` / medium | Two findings accepted: raw response logging and stale post callback wording.                                              |
| TypeScript/API docs     | `gpt-5.6-terra` / high  | N/A: no package export, public framework type, Protobuf schema, declaration surface, or public API documentation changes. |
| Performance/reliability | `gpt-5.6-terra` / high  | Three P1 findings accepted: burst delivery loss, stale pre-reconnect recovery, and post-completion lifecycle races.       |

Every dispatch states the existing role, expected model, and expected
reasoning. Actual runtime metadata or the immutable configured-profile
limitation is recorded before accepting a result.

## Pre-Review Mechanical Evidence

- Managed Chromium: 2/2 tests pass, including the 61-second continuity case;
  the corrected teardown case passes 1/1 without a false post failure.
- `verify:task` focused profile: 51/51 tests pass; changed production coverage
  is 97.97% statements, 92.99% branches, 100% functions, and 100% lines.
- Deterministic Proto, TypeScript, cleanup, TSDoc, formatting, docs, generated,
  and release-readiness checks pass.
- Lightweight status/API audit confirms the task record is current, the
  reducer remains example-local, and no README or package API claim was added.

## First Review Wave

All reviewers used the expected existing role/profile. Runtime
self-introspection was unavailable, so the immutable configured role/profile
and explicit dispatch are the accepted runtime metadata evidence. The desktop
dispatcher rejected a redundant Luna model override for the documentation
role; selecting the immutable documentation role explicitly dispatched its
configured `gpt-5.6-luna` / `medium` profile.

Accepted correction batch:

1. **P1 — burst delivery loss.** `useSubscriptionDelivery` exposes only the
   latest delivery, so React batching can skip an earlier valid batch. Preserve
   and consume every delivery, with a regression test that emits a burst
   before rendering settles.
2. **P1 — stale recovery after reconnect.** A reconnect resynchronization does
   not invalidate an older ordinary recovery query. Advance/invalidate the
   relevant generation and prove the older completion cannot replace the
   reconnect response.
3. **P1 — stale lifecycle at post completion.** The post callback captures the
   connection state from render/start time. Decide whether to refresh using
   the latest lifecycle when the command settles, with both transition races
   covered.
4. **P1 — raw response logging.** Reconnect logging exposes the authoritative
   `QueryResponse`, contradicting acceptance item 9 and the work log. Log only
   a safe summary.
5. **P2 — duplicate ordering policy.** Query rows and live rows have separate
   oldest-first comparators. Reuse one example-local ordering policy.
6. **P2 — stale callback documentation.** `PostForm` describes `onPosted` as a
   refresh callback although it is a post-success notification whose consumer
   conditionally refreshes.

No finding is rejected. Corrections affecting runtime behavior require focused
tests and re-review of style, documentation, and performance/reliability.

## Correction Implementation Evidence

All six accepted findings are implemented.

1. The optional `client-react` delivery callback consumes every stream value
   before React keeps only the latest observation; the Message Board reducer
   now uses it with a burst regression.
2. Reconnect resynchronization advances `updateGeneration`, preventing an
   older ordinary recovery response from replacing reconnect rows.
3. An optional immediate lifecycle callback keeps the post-completion decision
   current through connected-to-failed and failed-to-connected transitions.
4. Reconnect logs only board, target, and row count; no `QueryResponse` is
   logged.
5. `BoardRows.compare` is shared by authoritative query rows and live rows.
6. PostForm's parameter documentation calls `onPosted` a post-success
   callback.

The narrow client-react callback seam is a concrete, tested exception to the
earlier no-framework-API expectation: latest-only observation made burst-safe
example behavior impossible. It is optional, preserves subscription identity
when callback identities change, and has no reducer or Message Board policy.

Focused evidence: client-react and web TypeScript checks pass, focused
client-react plus Message Board Vitest passes 72/72, and changed production
ESLint, Prettier, and `git diff --check` pass. Re-review style/maintainability,
documentation, and performance/reliability; TypeScript/API docs is now
relevant because the client-react public hook adds documented callback
parameters.
