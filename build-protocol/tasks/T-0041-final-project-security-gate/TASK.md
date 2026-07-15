# T-0041: Final Project Security Gate

Status: In progress - canonical review wave 2 assigned

Started: `2026-07-14`

Baseline commit: `39f2c6f7`

Branch: `task/T-0041-final-project-security-gate`

Worktree: `.worktrees/T-0041-final-project-security-gate`

Dependency: T-0040c is complete, integrated, post-merge verified, remotely
synchronized, and cleaned up.

## Objective

Produce a repository-grounded threat model and dependency/security report,
resolve every release-blocking finding, and obtain a clean dedicated final
security review over the stable initial-release framework, documentation, and
example.

## Human-Imposed Requirements Ledger

- Continue autonomously until project completion or a real protocol blocker.
- This is the one final project-wide security gate that replaced per-task
  security reviewer lanes.
- Preserve accepted DDD, Spine Protobuf/type-URL, public API, generated-output,
  testing, review, logging, worktree, remote-push, and cleanup requirements.
- Inspect every public package, generated-code boundary, server/gRPC service,
  storage and delivery path, query/subscription path, handler analyzer/registry
  loader, transport/ZeroMQ path, testing utility, example, docs, and dependency.
- Check unsafe deserialization and `Any` handling; schema/type-URL confusion;
  validation/default-route bypass; tenant isolation; authorization/trust
  extension points; IPC permissions/injection/identity; path/symlink/module
  loading; sensitive logging; finite resource bounds; lifecycle leaks; and
  dependency/install-script risk.
- Create a committed repository-grounded threat model and security findings
  log before the dedicated final security reviewer is accepted.
- Run the package-manager dependency audit and distinguish runtime,
  development-only, unreachable, and accepted findings.
- Group any fixes by one trust boundary, use behavior-focused regressions, run
  relevant canonical review concerns, and rerun security review until clean.
- Do not weaken copied Spine Protobuf contracts or invent speculative public
  security APIs to compensate for deployment responsibilities that are outside
  the initial release.
- Do not report absent TLS, authentication, authorization, rate limiting,
  deployment hardening, or production persistence as an implementation defect
  when the repository explicitly assigns that control to the consuming
  application/deployment. Record the trust boundary and residual risk instead.
- Keep generated Protobuf and registry output ignored and untracked.
- Use focused verification during investigation/fixes and reserve full
  `pnpm verify` for the clean final task and post-merge gates.
- Dispatch every child with its existing role and explicit model/reasoning,
  record immutable runtime metadata, prohibit child subagents, and close each
  child promptly.
- Push the completed task branch and verified `main` to `origin`, record
  exact remote evidence, and remove only the clean merged worktree.
- Never read, edit, stage, delete, move, or use `human-review-1-jul.md`.

## Context Assumptions

- Spine TS is a server-side framework/library, not a hosted multi-tenant SaaS.
  It can expose Connect/gRPC-compatible services over Node HTTP/2, but the
  consuming application owns production ingress, TLS, authentication,
  authorization policy, rate limiting, deployment, and secrets.
- The server defaults to local-only loopback. Production options may expose a
  broader host, so network request messages are untrusted at the service
  boundary even though the example remains local-only.
- Framework payloads may contain arbitrary application-sensitive data.
  Confidentiality and authorization therefore depend on the consumer's ingress
  and policy controls; framework-owned validation, tenant routing, storage
  isolation, bounded work, and redacted errors still must hold.
- Multitenancy is supported only for contexts declared multitenant. Cross-tenant
  reads, writes, delivery, subscriptions, or storage keys are release-blocking.
- Local ZeroMQ IPC is a same-host trust boundary, not a remote hostile network
  transport or production process supervisor.
- CI, generated-registry loading, and dependency installation are
  developer/operator-controlled surfaces, but malicious package or tampered
  generated artifact scenarios remain in supply-chain scope.

## Acceptance Criteria

- `build-protocol/security/spine-ts-threat-model.md` follows the
  repository-grounded AppSec output contract with evidence anchors, trust
  boundaries, assets, attacker assumptions, abuse paths, prioritized threats,
  mitigations, focus paths, and explicit residual risks.
- `build-protocol/security/T-0041-security-findings.md` records the dependency
  audit, every security finding and disposition, verification evidence, and no
  unresolved critical/high-confidence release blocker.
- The dedicated final `security_reviewer` is dispatched only after those
  artifacts exist and repeats until clean or a human explicitly accepts a
  residual risk.
- Any code/config/docs fixes have focused regression evidence and clean
  relevant style, documentation, TypeScript/API docs, and
  performance/reliability dispositions.
- Full native task and post-merge `pnpm verify` pass with all global coverage
  dimensions at or above 90%; generated output remains ignored/untracked.
- All subagents are closed, the task branch and verified `main` are pushed,
  and the clean merged worktree is removed.

## Scope

- Read all tracked project source, Protobuf, docs, package manifests, lockfile,
  tests, scripts, and build protocol needed to establish security claims.
- Expected writes: this task/work/review record set,
  `build-protocol/security/spine-ts-threat-model.md`,
  `build-protocol/security/T-0041-security-findings.md`, and only bounded
  security fixes proven necessary by the final review.

## Out Of Scope

- Implementing application-specific authentication/authorization, TLS
  termination, deployment, secrets management, WAF/rate-limit policy,
  production persistence, tracing, monitoring, or multi-host transport.
- Changing copied Spine wire contracts without a concrete release-blocking
  vulnerability and compatibility strategy.
- Treating local examples/tests as production deployment blueprints.

## Risks And Guardrails

- Generic checklist findings are defects in the review process; every claim
  needs a repository path/symbol and realistic attacker prerequisite.
- Separate runtime, build/CI, test, and example surfaces so developer-only
  control does not inflate remote severity.
- Never record secret values or sensitive local environment contents.
- Prefer existing validation, limits, storage keys, lifecycle ownership, and
  tests as controls; verify rather than infer.
- A finding that changes public behavior, Protobuf compatibility, tenant
  semantics, or trust ownership requires explicit architecture escalation
  before implementation.

## Skill Applicability

- Selected: `security-threat-model`, `security-best-practices`,
  `stride-analysis-patterns`, `requesting-code-review`,
  `verification-before-completion`, `subagent-driven-development`, and
  `using-git-worktrees`.
- The installed security-best-practices references contain no exact
  Connect/Node library-framework profile; use the general workflow plus
  repository evidence and primary dependency documentation when version
  verification is needed.
- `architecture-patterns`, `domain-modeling`, and
  `architecture-decision-records` apply only if a finding changes trust or
  domain ownership. TDD/testing and TypeScript skills apply to concrete fixes.

## Security Architecture Split Assignment

- Existing `requirements_splitter`, explicit `gpt-5.6-sol` / high,
  read-only, no subagents or Git mutation.
- Map components, assets, entry points, trust boundaries, attacker
  capabilities/non-capabilities, required repository evidence, dependency
  audit method, and a bounded investigation/fix sequence.
- Cover every required threat check from the completion plan and identify
  which assumptions would materially alter severity. The repository already
  defines service/deployment scope, so record unresolved assumptions rather
  than pausing the autonomous cycle for routine confirmation.
- Return exact focus paths and commands; do not write the threat model or
  adjudicate findings.

## Accepted Security Architecture Split

- Splitter agent `019f62cb-d7fa-72b3-b0e9-d1ba22ff48c4` completed with the
  explicitly dispatched and immutable actual profile `gpt-5.6-sol` / high. It
  made no file or Git changes, spawned no children, and is closed.
- The accepted model has ten trust boundaries: network ingress, RPC-to-context,
  context-to-storage, persisted-record replay, framework-to-handler,
  same-host ZeroMQ IPC, source-to-generator, generated-module import,
  dependency installation, and diagnostics-to-consumer output.
- Investigation preserves this exact stable hypothesis mapping:
  `TM-001` tenant identity/auth binding; `TM-002` tenant
  propagation/isolation; `TM-003` malformed `Any`/schema/type URL; `TM-004`
  exposed HTTP/2/transport intake and payload/session/runtime growth; `TM-005`
  subscription/filter/slow-consumer exhaustion; `TM-006` delivery retry,
  retained attempt, corrupt-row, and lease work; `TM-007` local IPC spoofing,
  injection, oversized V8 frames, and endpoint manipulation; `TM-008`
  generated-root/module execution; `TM-009` dependency/install supply chain;
  `TM-010` sensitive error/stack/payload diagnostics; `TM-011`
  listener/session/subscription/worker/storage cleanup; and `TM-012`
  regex/analyzer disproportionate work.
- No hypothesis is pre-adjudicated as a finding. In particular, network intake,
  trusted local IPC, and generated-module execution depend on documented trust
  and exposure assumptions. No further Sol High escalation is currently
  justified.

## Security Artifact Author Assignment

- Existing `implementer`, expected explicit `gpt-5.6-terra` / medium, one
  bounded documentation owner, no subagents or Git mutation.
- Author only `build-protocol/security/spine-ts-threat-model.md` and
  `build-protocol/security/T-0041-security-findings.md`, plus the task/work log
  evidence needed for resumability. Do not change production code or
  adjudicate final reviewer findings.
- Preserve stable `TM-*` identifiers, classify dependency reachability and
  install-script risk, distinguish deployment residuals from framework defects,
  and anchor every security claim to repository evidence.

## Security Artifact Author Runtime Metadata

- Existing `implementer` agent `019f62d7-31cc-7c13-a0b1-61d25dff9e23` was
  dispatched with explicit model `gpt-5.6-terra` and explicit reasoning
  `medium`.
- Immutable runtime metadata confirms actual `gpt-5.6-terra` / `medium`.
- The author owns only the two security artifacts and necessary T-0041 task/work
  evidence entries, has no subagents, and must not mutate Git state.

## Initial Artifact Evidence

- The threat model and security findings report now exist under
  `build-protocol/security/`; both retain the dedicated security review and
  task completion as pending.
- Focused Prettier checks on the artifacts and T-0041 task/work records, plus
  `git diff --check`, passed after artifact formatting. See
  `build-protocol/work-logs/T-0041.md` for the exact command and result.

## Artifact Finding Batch 1 Fix

- Assigned coordinator findings are corrected in the owned artifact set: the
  exact stable TM mapping is restored, persistence ownership is narrowed to
  production adapters/deployment, and each threat row now carries asset,
  prerequisite/abuse path, control/evidence, investigation/status, and
  conditional severity.
- Dedicated security review and task completion remain pending.

## Dedicated Security Review Assignment

- Existing `security_reviewer`, expected explicit `gpt-5.6-terra` / high,
  read-only against the committed baseline-to-artifact package, no subagents or
  Git mutation.
- Adjudicate every `TM-*` hypothesis and `SF-*` disposition across the complete
  project scope. Report only repository-grounded findings with prerequisites,
  boundary/asset, severity/confidence, evidence, current control, and smallest
  correction.

## Security Review Round 1 Result

- Dedicated reviewer agent `019f62e5-7a3b-7e50-84d3-7f7991ffe7a5`, immutable
  actual `gpt-5.6-terra` / high, confirmed four release-blocking framework
  defects and is closed.
- `SF-007` (High): Connect's implicit approximately 4 GiB message limits permit
  excessive buffering/decompression before framework validation.
- `SF-008` (High): subscriptions have per-record TTL/queue bounds but no total
  framework ceiling across inactive and active subscriptions.
- `SF-009` (Medium): an omitted query format/limit permits an unbounded
  include-all result despite the declared 1,000-row cap.
- `SF-010` (Medium): the ZeroMQ IPC directory privacy check follows symlinks and
  does not verify POSIX ownership.

## Security Fix Architecture Assignment

- Existing `requirements_splitter`, expected explicit `gpt-5.6-sol` / high,
  read-only, no subagents or Git mutation.
- Select the smallest Spine-compatible public/internal contracts, exact finite
  defaults, TDD slices, and focused review/verification for `SF-007` through
  `SF-010`. Avoid speculative security APIs and preserve copied wire contracts.

## Accepted Security Fix Architecture

- Splitter agent `019f62cb-d7fa-72b3-b0e9-d1ba22ff48c4` completed with actual
  immutable `gpt-5.6-sol` / high, changed no files or Git state, spawned no
  children, and is closed.
- `SF-007`: top-level `ServerOptions.readMaxBytes` and `writeMaxBytes`, each
  defaulting to 4,194,304 and validated in `1..0xffffffff`, passed directly to
  Connect. No generic transport/security options object.
- `SF-008`: `SpineServicesOptions.subscriptionLimit`, default 100 positive safe
  integer, enforced by idempotent ID reservations across persistence,
  inactive/active lifetime, recovery, and exact cleanup.
- `SF-009`: every storage query receives the 1,000-row safety cap when the wire
  format/limit is absent or zero; explicit positive ordered limits remain
  unchanged. No Protobuf change and no new client requirement.
- `SF-010`: reject the final-directory symlink and attacker-substitutable
  ancestor aliases, but admit root-owned aliases in root-owned non-writable
  parents such as macOS `/var` and `/tmp`. Canonicalize once, create missing
  components without recursive `mkdir`, require final POSIX effective-UID
  ownership and exact `0700`, then recheck canonical identity immediately
  before native bind/connect. Do not claim impossible pathname race elimination
  or POSIX ownership enforcement on non-POSIX hosts.

## Security Fix Implementer Assignment

- Existing `implementer`, expected explicit `gpt-5.6-terra` / medium, one owner
  for all four findings in three sequential slices, no subagents or Git
  mutation.
- TDD order: `SF-007`; `SF-008` plus `SF-009`; then `SF-010`. Update source,
  behavior tests, public TSDoc/docs, security artifacts, and durable records.

## Security Fix Implementation Session

- Existing `implementer`, previously dispatched explicitly as
  `gpt-5.6-terra` / medium, resumed at `869a225d` with immutable actual runtime
  metadata `gpt-5.6-terra` / medium. No subagents or Git mutation.
- Slice 1 starts with a public-constructor behavior test requiring both network
  message bounds to reject non-integers and values outside `1..0xffffffff`.
  Exact RED and GREEN commands/results are recorded in the work/review logs.
- Slice 1 validation RED is confirmed: the focused constructor test exited 1
  because invalid values were accepted. Implementation now exposes the two
  top-level options, validates them, and forwards them directly to Connect;
  constructor GREEN passed. Native uncompressed forwarding RED then confirmed
  the command was accepted when forwarding was absent; GREEN remains pending.
- Slice 1 complete: constructor validation GREEN passed; native configured
  forwarding RED/GREEN covered compressed and uncompressed requests and
  oversized responses; exact default RED/GREEN proved 4,194,304 bytes. SF-007
  is implemented pending security re-review.
- Slice 2 capacity RED: `pnpm --config.verify-deps-before-run=false exec vitest
run packages/server/test/services/spine-services.test.ts -t 'validates the
process-local subscription capacity|reserves capacity synchronously'` exited
  1 with 2 failed/102 skipped because invalid limits were accepted and a second
  pending subscription was not rejected. The identical GREEN exited 0 with 2
  passed/102 skipped after adding the validated default-100 option and private
  ID reservation set.
- Slice 2 query RED: the focused `-t 'adds the implicit storage query
cap|applies tenant filtering before the implicit storage query cap'` command
  exited 1 with 2 failed/104 skipped: three implicit queries had no storage
  limit and a 1,001-row tenant returned 1,001 rows. The identical GREEN exited
  0 with 2 passed/104 skipped after applying `MAX_QUERY_LIMIT=1000` for absent
  or zero wire limits.
- Slice 2 lifecycle/recovery coverage passed in two focused runs: 8 passed/103
  skipped for option/default, persistence/remember rollback, deletion failure,
  and duplicate activation; 5 passed/109 skipped for capacity-preserving
  recovery, CAS loss/error release, queue overflow, and activation failure.
  SF-008/SF-009 are implemented pending security re-review; SF-010 remains.
- Slice 2 full-file verification first produced 19 sandbox-only loopback
  `listen EPERM` failures while 95 non-network tests passed. The approved native
  rerun superseded it and exited 0 with 114/114 tests passed.
- Slice 3 path-policy RED: `pnpm --config.verify-deps-before-run=false exec
vitest run packages/transport/test/zeromq/signal-transport.test.ts -t 'final
IPC directory symlink|ancestor IPC directory symlink|exact POSIX
0700|different effective user'` exited 1 with 4 failed/20 skipped because
  links, special mode, and foreign effective ownership were accepted. The
  identical GREEN exited 0 with 4 passed/20 skipped after canonical preparation
  and exact final-directory validation.
- Slice 3 pre-native recheck RED temporarily omitted only the subscriber
  recheck; the focused replacement test exited 1 with 1 failed/26 skipped
  because mocked native connect was reached. Restoring the recheck made the
  identical command exit 0 with 1 passed/26 skipped.
- Canonical alias/replacement coverage needed native IPC after a sandbox
  `Operation not permitted`; the native run exited 0 with 3 passed/24 skipped.
  Full native `signal-transport.test.ts` then passed 27/27. The first four-file
  native smoke/cross-process run exposed three macOS socket-path `File name too
long` failures; short `/tmp` aliases now canonicalize to `/private/tmp`, and
  the rerun passed 4 files/40 tests. `typecheck:build:generated` exited 0.
- SF-010 is implemented pending security re-review. The accepted residual is
  explicit: pathname ZeroMQ cannot eliminate substitutions after the final
  check, so deployment must select a canonical directory beneath a
  non-attacker-writable parent. Task closure remains pending.
- Endpoint checks: native Server/SpineServices verification exited 0 with 2
  files/136 tests; native ZeroMQ adapter/smoke/transport/cross-process
  verification exited 0 with 4 files/40 tests. `typecheck:generated` first
  exited 2 on two test-only typing defects, then exited 0 after correction.
  `docs:check` exited 0 with 25 copied proto checksums and expected export counts
  of 100/28/205/19/17/3. Focused ESLint, Prettier check, and `git diff --check`
  exited 0. Dedicated re-review, canonical reviews, full verification, and task
  completion remain pending.

## IPC Architecture Validation Finding

- Native macOS evidence shows `os.tmpdir()` resolves through `/var`, while
  `/var` and `/tmp` are root-owned system symlinks to `/private/...`.
- Literal rejection of every ancestor symlink would break existing supported
  local IPC and example/test paths. The same splitter must revise only this
  path rule before implementation; final-directory non-link, ownership, mode,
  identity recheck, and honest TOCTOU limits remain binding.

## IPC Architecture Correction Accepted

- The resumed splitter was explicitly dispatched as the existing
  `requirements_splitter` with expected `gpt-5.6-sol` / high; immutable runtime
  metadata confirms actual `gpt-5.6-sol` / high. It changed no files or Git
  state, spawned no children, and is closed.
- Walk the lexical path with `lstat`. On POSIX, an ancestor symlink is accepted
  only when the link and its non-group/world-writable containing directory are
  root-owned; the final component may never be a link.
- Pin the deepest existing component by followed `dev`/`ino` plus `realpath`,
  append and create missing components one at a time, and discard the original
  alias. Every endpoint and cleanup path uses the completed canonical path.
- The final directory must be owned by the effective POSIX user with exact
  `0700`. Immediately before each native bind/connect, repeat canonical-path,
  type, ownership, mode, and identity checks, then derive and use the endpoint
  without an intervening `await`.
- Non-POSIX hosts still reject a final link, canonicalize once, create
  components non-recursively, require a directory, and recheck stable identity
  where available; docs must not claim portable UID or mode enforcement.
- Residual risk remains explicit: pathname-based ZeroMQ cannot bind relative to
  a held directory descriptor, so substitution after the final recheck cannot
  be eliminated. Deployments must use a canonical path under a parent that is
  not attacker-writable.

## Security Fix Implementation Dispatch

- Resume existing implementer `019f62d7-31cc-7c13-a0b1-61d25dff9e23` with
  explicit expected `gpt-5.6-terra` / medium, no subagents and no Git mutation.
- The same owner executes three sequential TDD slices: `SF-007`; `SF-008` plus
  `SF-009`; then corrected `SF-010`. It owns the affected production sources,
  behavior tests, public TSDoc/docs, security artifacts, and durable records.
- Each slice must show the focused red/green evidence before the next slice;
  generated Protobuf output remains untracked.

## Coordinator Fix-Endpoint Finding

- `prepareIpcDirectory()` verifies a missing component only when `mkdir()`
  reports `EEXIST`. After successful creation it advances without immediately
  checking that the new object is still the intended non-link directory.
- This contradicts the accepted SF-010 rule to re-run `lstat()` for every
  created or raced suffix component before descending. Resume implementer
  `019f62d7-31cc-7c13-a0b1-61d25dff9e23`, expected explicit immutable
  `gpt-5.6-terra` / medium, for one focused TDD correction; no subagents or Git
  mutation.

## Coordinator Fix-Endpoint Acceptance

- The resumed implementer returned with actual immutable
  `gpt-5.6-terra` / medium, immediate successful-create `lstat` verification,
  deterministic RED/GREEN evidence, and no Git mutation or child agents; it is
  closed.
- Fresh native affected verification passed 6 files and 177 tests. Build and
  tooling typechecks, docs/API generation, focused ESLint/Prettier, lightweight
  docs/status/public-leak/duplicate-policy/overclaim scans, generated-output
  tracking check, and `git diff --check` all passed.
- Security fixes are ready for one immutable package, the four canonical
  concern lanes, and dedicated security re-review. Task closure remains
  pending.

## Canonical Review Wave Assignment

- Immutable package `.superpowers/sdd/review-39f2c6f7..5714e97c.diff` covers 9
  commits and 208,732 bytes from the task baseline through the verified security
  fix endpoint.
- Assign the four existing concerns: style/maintainability
  `gpt-5.6-terra` / high; documentation `gpt-5.6-luna` / medium;
  TypeScript/API docs `gpt-5.6-terra` / high; and
  performance/reliability `gpt-5.6-terra` / high. All are read-only, may not
  spawn subagents, and must ignore historical superseded text unless current
  task/status records or changed public docs claim it active.

## Coordinator IPC Correction Evidence

- Existing implementer `019f62d7-31cc-7c13-a0b1-61d25dff9e23` resumed with
  expected/actual immutable `gpt-5.6-terra` / medium, no subagents and no Git
  mutation.
- Focused RED: `pnpm --config.verify-deps-before-run=false exec vitest run
packages/transport/test/zeromq/signal-transport.test.ts -t 'rejects a suffix
directory replaced immediately after successful creation'` exited 1 with 1
  failed/27 skipped. Replacing the first successfully created suffix with a
  symlink produced only the later canonical-path error instead of immediate
  unsafe-component rejection.
- A package-private filesystem seam wraps the existing `mkdir()` only for
  deterministic race injection. The suffix loop now performs `lstat()` after
  both successful creation and `EEXIST`, rejects a symlink/non-directory, and
  only then advances. No public interface changed.
- Focused GREEN: the identical command exited 0 with 1 passed/27 skipped. Full
  native `signal-transport.test.ts` exited 0 with 1 file/28 tests. Security
  fixes are implemented; dedicated security re-review and task closure remain
  pending.

## Canonical Review Wave Result

- TypeScript/API docs is CLEAN: agent
  `019f6326-9fae-7561-b033-cb126e2a8b3f`, actual immutable
  `gpt-5.6-terra` / high.
- Documentation redispatch is profile-valid and CLEAN: agent
  `019f6329-25b0-7242-85da-177f5e01deca`, actual immutable
  `gpt-5.6-luna` / medium. Coordinator nevertheless confirmed two concrete
  findings from the rejected first attempt: stale threat-model provenance and
  ambiguous zero-vs-positive query-limit wording.
- Style/maintainability agent `019f6329-fbff-7fe3-be34-825e15f837f4`, actual
  immutable `gpt-5.6-terra` / high, found oversized IPC preparation, missing
  request/publisher recheck regressions, and overlong local names.
- Performance/reliability agent `019f6328-bdca-7a00-9ce0-9c7151aee82d`, actual
  immutable `gpt-5.6-terra` / high, found same-ID recovery reservation ownership
  and in-flight request shutdown defects.
- Resume the existing implementer, expected explicit immutable
  `gpt-5.6-terra` / medium, for the complete seven-item TDD fix batch. All
  reviewers are closed and dedicated security re-review waits for a corrected
  canonical endpoint.

## Canonical Fix Coordinator Acceptance

- Existing implementer returned with actual immutable
  `gpt-5.6-terra` / medium, all seven findings addressed, no subagents or Git
  mutation, and is closed.
- Fresh coordinator native verification passed SpineServices and signal
  transport: 2 files/144 tests. Build/tooling typechecks, docs/API generation,
  focused ESLint/Prettier, status/naming/wording scans, generated tracking, and
  `git diff --check` passed.
- The corrected endpoint is ready to commit and package for the next four-lane
  canonical wave. Dedicated security re-review and task closure remain pending.

## Canonical Review Wave 2 Assignment

- Committed canonical fixes at `19728018` and generated immutable package
  `.superpowers/sdd/review-39f2c6f7..19728018.diff` (12 commits, 236,186 bytes).
- Repeat all four existing concerns with explicit immutable role attestation:
  style Terra High, documentation Luna Medium, TypeScript/API Terra High, and
  performance/reliability Terra High. Read-only, no subagents or Git mutation;
  aggregate the complete wave before fixes.

## Canonical Review Fix Batch Implementation

- Existing implementer `019f62d7-31cc-7c13-a0b1-61d25dff9e23` completed the
  batch with actual immutable `gpt-5.6-terra` / medium, no subagents, and no Git
  state mutation.
- Subscription reservation acquisition now reports ownership. A duplicate
  in-flight same-ID recovery returns before CAS and only the operation that
  inserted the reservation may release it.
- In-flight requests are tracked through IPC preparation/recheck. Close waits
  for them, and closed state is rechecked before native connect/send.
- IPC preparation is split into lexical walk/anchor, missing-suffix
  create/verify, and final validate/freeze stages. Replacement prevention now
  covers subscriber/request connect and responder/publisher bind; requested
  identifier and documentation corrections are applied.
- Focused RED evidence: the same-ID recovery test exited 1 with 1 failed/114
  skipped because a distinct subscription was admitted instead of returning
  `ResourceExhausted`; the request-close test exited 1 with 1 failed/28 skipped
  because close settled while preparation was paused. Two intermediate
  post-reservation-fix runs timed out while the concurrency harness was being
  bounded; the final deterministic harness supersedes them.
- Focused GREEN evidence: same-ID recovery exited 0 with 1 passed/114 skipped;
  the four recovery cases exited 0 with 4 passed/111 skipped; request-close
  exited 0 with 1 passed/28 skipped; request-close plus all four replacement
  paths exited 0 with 2 passed/27 skipped.
- Full native affected files exited 0: SpineServices 115/115 and signal
  transport 29/29. An initial sandboxed SpineServices run had 19 loopback
  failures with `listen EPERM`; the native rerun supersedes that environment
  denial. `typecheck:generated`, focused ESLint, focused Prettier check,
  `docs:check`, and `git diff --check` all exit 0. Final dedicated security
  re-review and task closure remain pending.
