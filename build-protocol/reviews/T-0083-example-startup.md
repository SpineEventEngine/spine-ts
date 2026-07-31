# T-0083 Review Log

Task log: `build-protocol/tasks/T-0083-example-startup/TASK.md`
Branch: `task/T-0083-example-startup`
Baseline commit: `c6f8d79419303b29079b49aad3b4b2ef8ecfc7d1`
Reviewed endpoint: `ab3f018a08902537e1f213db0898ff739c06b581`
Worktree: `.worktrees/T-0083-example-startup`
Status: Converged

## Canonical Concern Plan

| Concern                 | Disposition                               | Reason                                                                               |
| ----------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------ |
| Style/maintainability   | Required                                  | New process entry points and startup composition affect example structure            |
| Documentation           | Required                                  | Every example README and its executable claims are in scope                          |
| TypeScript/API docs     | Required if TypeScript or snippets change | Entry-point declarations and browser/server examples must remain accurate            |
| Performance/reliability | Required                                  | Readiness, shutdown, ports, child processes, and browser/server communication change |

## Review Snapshot

The orchestrator staged only the 32 T-0083 paths and froze writer activity
during the review wave. The initial staged binary diff checksum was
`2b0886fd24ddb3440e0b1ef66c0ca6a4d1d9639ee06c26ee32c0218366fde3fd`.
The dispatch record itself was the only subsequent pre-review edit; the
orchestrator supplies the resulting checksum to every reviewer.

## Dispatch Metadata

| Concern                 | Existing role                      | Scope                                                                 | Expected model  | Expected reasoning | Dispatch requirement |
| ----------------------- | ---------------------------------- | --------------------------------------------------------------------- | --------------- | ------------------ | -------------------- |
| Style/maintainability   | `style_maintainability_reviewer`   | Staged implementation, tests, scripts, structure, and naming          | `gpt-5.6-terra` | high               | Explicit             |
| Documentation           | `documentation_reviewer`           | All staged example guides, command claims, limitations, and TSDoc     | `gpt-5.6-luna`  | medium             | Immutable role       |
| TypeScript/API docs     | `typescript_api_docs_reviewer`     | Authored TypeScript contracts, declarations, TSDoc, and compatibility | `gpt-5.6-terra` | high               | Explicit             |
| Performance/reliability | `performance_reliability_reviewer` | Startup, readiness, shutdown, resources, ports, and browser topology  | `gpt-5.6-terra` | high               | Explicit             |

The documentation role has an immutable Luna/medium profile and the execution
surface does not accept a redundant model override for that configured role.
All other review dispatches must set model and reasoning explicitly. Every
reviewer is read-only, may not spawn subagents, build Spine JVM, or inspect the
protected human-review files, and must report findings against the frozen
staged snapshot.

## Findings

### Wave 1

All reviewers confirmed the frozen checksum
`b9e4189adb3cb1bb9994233f3c42c9d5523cd26975a47955b8e5302868e4bca3`.
Runtime self-metadata was unavailable for every reviewer. The configured
immutable role/profile is accepted evidence under the protocol.

| Concern                 | Reviewer role                      | Configured profile                | Result                                                                                                                                                                                                   |
| ----------------------- | ---------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Style/maintainability   | `style_maintainability_reviewer`   | `gpt-5.6-terra`, high, explicit   | Three P2 findings: six unjustified standalone functions; oversized local server composition; missing Chat `start` script contract assertions.                                                            |
| Documentation           | `documentation_reviewer`           | `gpt-5.6-luna`, medium, immutable | One P2 finding: Chat, Projects, and Orders entry documents omit the Node 24+/pnpm prerequisite. All other command, readiness, shutdown, URL, limitation, and real-vs-test claims are accurate.           |
| TypeScript/API docs     | `typescript_api_docs_reviewer`     | `gpt-5.6-terra`, high, explicit   | Two P2 findings: local gateway URL accepts invalid ports and lacks user documentation; Chat docs contradict the new local Connect CLI topology. No export, dependency, Protobuf, or compatibility issue. |
| Performance/reliability | `performance_reliability_reviewer` | `gpt-5.6-terra`, high, explicit   | Four P1 findings: streaming shutdown deadlock; post-backend setup leak; unsafe concurrent/retry close plus duplicate binding ownership; missing lifecycle/failure regression coverage. No auth bypass.   |

Every finding is accepted. The complete correction batch goes to the existing
implementation owner. P1 fixes require focused lifecycle and child-process
tests. P2 code/API fixes require focused unit and manifest-contract tests.
Documentation-only corrections do not independently reopen review lanes.

The original implementation context completed the P2 batch and most lifecycle
code, but stopped repeatedly before the acquisition and signal-test slice.
The orchestrator therefore treats that context as unavailable and dispatches
one fresh bounded owner:

- Existing role: `implementer`.
- Scope: decorator-free acquisition rollback, active-stream shutdown, and
  compiled `SIGINT`/`SIGTERM` port-release tests; final server decomposition
  and correction verification only.
- Expected model: `gpt-5.6-terra`.
- Expected reasoning: medium.
- Both fields must be explicit in dispatch.
- The owner may not spawn subagents, commit, push, build Spine JVM, or inspect
  protected human-review files.

The fresh owner completed the bounded slice under the explicitly configured
`implementer`, `gpt-5.6-terra`, medium profile. Runtime self-metadata was not
exposed; the immutable configured profile is accepted evidence. Focused
elevated verification passed 9 files and 55 tests, including acquisition
rollback, active-listener release, retryable close, and compiled
`SIGINT`/`SIGTERM` port release. Generated build, exact lint, formatting, and
diff integrity also passed.

## Targeted Re-review Dispatch

Corrections substantively affect style/maintainability, TypeScript/API docs,
and performance/reliability. Documentation corrections are deterministic and
do not independently reopen that lane.

| Concern                 | Existing role                      | Expected model  | Expected reasoning |
| ----------------------- | ---------------------------------- | --------------- | ------------------ |
| Style/maintainability   | `style_maintainability_reviewer`   | `gpt-5.6-terra` | high               |
| TypeScript/API docs     | `typescript_api_docs_reviewer`     | `gpt-5.6-terra` | high               |
| Performance/reliability | `performance_reliability_reviewer` | `gpt-5.6-terra` | high               |

All model and reasoning fields must be explicit. Re-review is read-only and
limited to the accepted findings and substantively affected corrected paths.

### Targeted Re-review Result

All reviewers matched staged checksum
`52c960edcc4c3cac9975ddbc753f86ee68b0ef54abb660d1f89470a7dd7f2016`.
Runtime self-metadata remained unavailable; the immutable configured profiles
are accepted.

- Reliability: one P1 remains. A listener timeout exits cleanup before the
  backend phase and retry starts a duplicate listener close instead of
  retaining the in-flight operation.
- Style/maintainability: two P2 findings remain. `LocalChatLifecycle` lacks the
  required TSDoc, and gateway assembly remains oversized behind a catch-all
  values object.
- TypeScript/API docs: two P2 findings remain. The same lifecycle TSDoc defect
  plus required blank-line layout is confirmed, and the family README still
  contains two legacy statements contradicting the local Connect CLI.

Resolved findings stay closed: standalone-function ownership, Chat start
script assertions, URL validation and documentation, acquisition rollback,
active-listener release, signal exits and port rebind, close sharing/retry for
ordinary failures, sole binding ownership, and the auth/CORS boundary.

### Final Correction Evidence

The same bounded `implementer` completed the consolidated re-review batch under
the explicit `gpt-5.6-terra`/medium profile; runtime self-metadata remains
unavailable.

- Observed RED: listener timeout rejected before backend cleanup and a retry
  could duplicate listener close.
- GREEN: `LocalChatLifecycle` retains the in-flight listener promise across a
  bounded wait, aggregates timeout failures, continues backend cleanup, and
  retries the same promise until listener close itself rejects.
- GREEN: lifecycle TSDoc now documents the class, constructor collaborators,
  close, and acquisition contract; interface-member TSDoc uses required blank
  spacing. The local server has named session, gateway-request/routing, HTTP
  listener, and timeout owners, with a short `gatewayFor` seam. The family
  README distinguishes the private local CLI from the exported library and
  binary Connect from Envoy gRPC-Web interoperability.

## Outcome

Converged. Final targeted reviewers matched staged checksum
`e0b29f58e16638494ea6a008a597d576490494eec693e8499bb5772be9e883a0`.
Style/maintainability, TypeScript/API docs, and performance/reliability all
returned clean with no remaining P0/P1/P2. The documentation lane remained
closed because its deterministic corrections were mechanically verified.

Final elevated focused verification, TSDoc, generated build, exact generated
lint, formatting, and diff integrity passed.

### Coverage Correction Re-review

The first full gate passed 3,221 tests but reported 89.79% branches. The
threshold was not lowered and production was not excluded. The implementer
extracted decorator-free local server seams and added focused behavior tests
for authentication request parsing, CORS/HTTP listener behavior, bounded
cleanup, lifecycle failure aggregation/retry, and browser lifecycle guards.
Global coverage now passes exactly 90.00% (`10,193/11,326` branches).

Because the correction moved production composition, style/maintainability,
TypeScript/API docs, and performance/reliability receive one final narrow
read-only check against the corrected staged snapshot. Documentation does not
reopen because no user-facing claim changed.

The final narrow check converged:

- Style/maintainability: clean after every seam signature and implementation
  received direct member-level TSDoc.
- TypeScript/API docs: clean; seam exports remain internal and typed.
- Performance/reliability: clean; runtime seam tests use only ephemeral port
  `0`, while the compiled entry test alone proves documented port `8090`.
- Full verification passed 166 files / 3,231 tests and 90.04% branch coverage.

## Correction Evidence

The bounded implementation owner completed the remaining P1 lifecycle slice on
2026-07-31 with the configured `implementer` role, explicit
`gpt-5.6-terra`/medium dispatch, and no runtime self-metadata surface.

- Observed RED: the prior acquisition test could not register resources after
  backend startup; the replacement failed because the scope was absent.
- GREEN: `LocalChatLifecycle` now owns decorator-free acquisition rollback,
  retries only unsuccessful cleanup phases, shares concurrent close promises,
  bounds listener waits, and begins listener close before subscription shutdown
  can release active streams. `SubscriptionGateway` remains the sole bindings
  owner.
- Observed RED: the compiled SIGTERM test exposed a readiness-to-signal-handler
  race and received signal termination (`null`) rather than exit code `0`.
- GREEN: the entrypoint installs both handlers before readiness; compiled
  SIGINT/SIGTERM tests each exit `0` and prove port `8090` can be rebound.
- Final evidence: elevated focused app/web/startup Vitest passed 9 files / 55
  tests; `typecheck:build:generated`, exact `lint:generated`, scoped Prettier,
  and `git diff --check` passed. Restricted loopback runs still fail with
  sandbox `EPERM`; elevated test execution is the real listener evidence.
