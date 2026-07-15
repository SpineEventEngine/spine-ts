# T-0041: Final Project Security Gate

Status: In progress - canonical review wave 16 assigned

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

## Wave 4 Implementation Status

- Existing implementer `019f62d7-31cc-7c13-a0b1-61d25dff9e23` has actual
  immutable runtime `gpt-5.6-terra` / medium, matching the explicit dispatch.
  No subagent or Git-state mutation was used.
- D-0087 is implemented in the working tree: compatible inactive records,
  unique exact active claims, exact cancel markers, owner-aware CAS activation
  and cancellation, bounded unknown removals, and deterministic cross-instance
  race/failure coverage.
- Focused RED/GREEN evidence is durable in the work/review logs. The final
  native affected service suite passes 130/130; generated/tooling typecheck,
  docs, focused lint/format, provenance/export/policy/generated scans, and diff
  integrity are green.
- Canonical review, dedicated security re-review, full final verification,
  integration, remote sync, and T-0041 closure remain pending.

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

## Canonical Review Wave 2 Result

- Style/maintainability is CLEAN: agent
  `019f633d-911a-75e3-b87f-bf42a589a6db`, actual immutable Terra High.
- Documentation agent `019f633d-8995-7b41-b811-4fcae0beeeed`, actual immutable
  Luna Medium, found stale post-commit threat-model provenance.
- TypeScript/API agent `019f633d-8d8c-76c1-a270-dd17692f4252`, actual immutable
  Terra High, found that public prose incorrectly implies a process-wide limit
  instead of one limit per `SpineServices` instance.
- Performance/reliability agent `019f633f-0ce6-7322-abcd-8cd8f3dea9c0`, actual
  immutable Terra High, found cancel-versus-recovery can release a reservation
  it does not own and later revive the canceled subscription.
- All reviewers are closed. Resume existing implementer, expected immutable
  Terra Medium, for this complete three-item TDD/docs batch. Preserve the
  Set-backed capacity authority while adding exact ownership/cancel
  coordination; dedicated security re-review remains pending.

## Canonical Wave 2 Fix Acceptance

- Existing implementer returned with actual immutable
  `gpt-5.6-terra` / medium, the complete three-item batch, no subagents or Git
  mutation, and is closed.
- Fresh coordinator native SpineServices verification passed 117/117. Build
  and tooling typechecks, docs/API generation, focused ESLint/Prettier,
  status/provenance/per-instance scans, generated tracking, and
  `git diff --check` passed.
- The endpoint is ready for commit and canonical wave 3. Dedicated security
  re-review and task closure remain pending.

## Canonical Review Wave 3 Assignment

- Committed wave-two fixes at `ffd8549e`; immutable package
  `.superpowers/sdd/review-39f2c6f7..ffd8549e.diff` covers 15 commits and
  260,743 bytes.
- Repeat style Terra High, documentation Luna Medium, TypeScript/API Terra
  High, and reliability Terra High with immutable profile attestation. Read-only,
  no subagents/Git mutation, complete-wave aggregation, and superseded-history
  exclusion remain binding.

## Canonical Review Wave 3 Result

- Documentation agent `019f6354-2428-7b11-af1d-46180b16e05c`, actual immutable
  Luna Medium, found missing explicit `ffd8549e` package provenance and one
  findings-table path missing the `packages/` prefix.
- TypeScript/API agent `019f6354-1c3f-7201-ae11-aced62f14e6d`, actual immutable
  Terra High, found the public class TSDoc omits absent/zero query cap behavior.
- Style agent `019f6354-2086-7c13-8614-6967eba71850`, actual immutable Terra
  High, found a high resident-cancel/delayed-delete recovery revival race and an
  oversized recovery method.
- Reliability agent `019f6356-685b-7ab1-913d-3166033fdea6`, actual immutable
  Terra High, independently confirmed the same high revival race.
- All reviewers are closed. Resume the existing Terra Medium implementer for
  the deduplicated four-item batch: per-ID removal coordination held through
  durable deletion, recovery exclusion/await, deterministic race regression,
  recovery method split, query-cap TSDoc, and security provenance/path fixes.

## Canonical Wave 3 Fix Acceptance

- Existing implementer returned with actual immutable
  `gpt-5.6-terra` / medium, all four findings addressed, no subagents or Git
  mutation, and is closed.
- Fresh coordinator native service verification passed 120/120. Build/tooling
  typechecks, docs/API generation, focused ESLint/Prettier,
  status/provenance/path/TSDoc scans, generated tracking, and diff integrity
  passed.
- Commit and package this endpoint for canonical wave 4. Dedicated security
  re-review and T-0041 closure remain pending.

## Canonical Review Wave 4 Assignment

- Committed wave-three fixes at `5a165d07`; immutable package
  `.superpowers/sdd/review-39f2c6f7..5a165d07.diff` covers 18 commits and
  288,174 bytes.
- Repeat style Terra High, documentation Luna Medium, TypeScript/API Terra
  High, and reliability Terra High with explicit profile attestation. Review
  both cancellation orderings, complete current claims, and the full changed
  surface; read-only/no subagents/Git mutation and complete-wave aggregation
  remain binding.

## Canonical Review Wave 4 Result

- Style is CLEAN: agent `019f6367-ae14-7f93-b09c-f8629e98e664`, actual
  immutable Terra High.
- TypeScript/API is CLEAN: agent `019f6367-b226-7a83-b3b6-1d49c24d0a7e`,
  actual immutable Terra High.
- Documentation agent `019f6367-b61a-7c52-b67a-af00b5711d4b`, actual immutable
  Luna Medium, found runtime provenance must advance to `5a165d07` and the
  findings status must name active wave 4.
- Reliability agent `019f6369-9854-73f2-8bbb-31f3a390de96`, actual immutable
  Terra High, found two highs: local removal cannot fence recovery in another
  shared-storage `SpineServices`, and arbitrary unique unknown cancel IDs create
  unbounded in-flight tombstones/storage deletes.
- All reviewers are closed. Resume existing `requirements_splitter`
  `019f62cb-d7fa-72b3-b0e9-d1ba22ff48c4`, expected explicit immutable Sol High,
  read-only/no subagents/Git mutation, to define the smallest persistence-scoped
  cancellation/recovery fence and bounded unknown-removal contract before
  implementation.

## Wave 4 Architecture Decision And Fix Assignment

- Existing `requirements_splitter` agent
  `019f62cb-d7fa-72b3-b0e9-d1ba22ff48c4` completed read-only with actual
  immutable `gpt-5.6-sol` / high, matching the explicit expected profile, and
  is closed. It spawned no subagents and made no repository changes.
- Its skill check inspected the project protocol, expected-skill manifest,
  installed metadata, current storage/service implementation, security
  artifacts, and relevant JVM evidence. Security threat/mitigation skills were
  applicable; implementation, TDD, worktree, and review skills were N/A for the
  read-only architecture role.
- D-0087 accepts package-private JSON-in-`Any` inactive, owned-claim, and
  cancel-marker states. Exact CAS transitions make activation ownership
  persistent across storage handles. Remote cancellation of another instance's
  claim returns `Aborted`; successful cancellation cannot coexist with revived
  activation. Existing inactive rows remain compatible.
- Distinct non-local removals use a separate per-instance pool bounded by
  `subscriptionLimit`; same-ID work shares one operation and overflow rejects
  before storage with `ResourceExhausted`.
- Resume existing `implementer` `019f62d7-31cc-7c13-a0b1-61d25dff9e23`,
  expected explicit immutable `gpt-5.6-terra` / medium, for one bounded TDD,
  runtime, docs, security-artifact, and durable-log batch. No subagents or Git
  mutation. Canonical and dedicated security review remain pending.

## Wave 4 Implementer Skill Applicability

- Before code actions, existing implementer
  `019f62d7-31cc-7c13-a0b1-61d25dff9e23` confirmed the Desktop runtime metadata
  matches the explicit immutable `gpt-5.6-terra` / medium assignment. No
  subagents or Git-state mutation are authorized.
- Session inventory, `build-protocol/skills/EXPECTED_SKILLS.md`, the full
  `find ~/.agents/skills -maxdepth 2 -type f -name SKILL.md -print` inventory,
  and readable `/Users/armiol/.agents/.skill-lock.json` were checked. The lock
  confirms the expected `obra/superpowers` and `wshobson/agents` sources; the
  session also exposes the task-provided Codex security skill.
- Fully read and selected: `test-driven-development` plus its testing
  anti-pattern reference, `javascript-testing-patterns` plus its advanced async
  and integration reference, `typescript-advanced-types`,
  `nodejs-backend-patterns`, `security-best-practices`,
  `receiving-code-review`, and `verification-before-completion`. They govern
  strict RED/GREEN evidence, deterministic shared-storage tests, compact
  discriminated internal states, stable Connect errors, secure exact-CAS
  transitions, review verification, and evidence-before-claims.
- The security skill has no Connect/Node backend reference; its Express and
  Next.js references are not applicable. Project-owned ingress/TLS/rate policy
  and D-0087 override generic backend suggestions. Planning, worktree,
  subagent-development, and Git skills are skipped because architecture is
  accepted, this worktree already exists, and this assignment forbids
  subagents/Git mutation.
- Reconfirmed the splitter's recorded inspection of current service/storage
  code and task-relevant Spine JVM evidence. D-0087 and existing repository
  behavior define this fix; no lease, heartbeat, routing, supervision,
  reclamation, or other JVM-inspired behavior is added.

## Canonical Wave 3 Fix Implementation

- Existing implementer `019f62d7-31cc-7c13-a0b1-61d25dff9e23`, actual
  immutable `gpt-5.6-terra` / medium, implemented the complete batch without
  subagents or Git state mutation. Canonical and dedicated security re-review
  remain pending.
- RED command: `pnpm --config.verify-deps-before-run=false exec vitest run
packages/server/test/services/spine-services.test.ts -t 'blocks resident
recovery while durable cancellation is pending'`; exit 1, 1 failed/117 skipped.
  Recovery reached CAS while resident durable deletion was paused, proving the
  canceled ID could revive.
- GREEN rerun of that command exited 0 with 1 passed/117 skipped. A second
  post-read gate regression exited 0 with 1 passed/118 skipped, and the shared
  cancellation/delete-failure cleanup regression exited 0 with 1 passed/119
  skipped.
- A package-private per-ID removal operation is installed before resident
  release/removal, shared by concurrent cancellation, and retained through
  durable-delete settlement. Recovery observes it before each store read and
  after an awaited read/restore; the existing recovery-owner token path remains
  intact. Recovery is split into a small outer iterator and explicit per-store
  attempt/consume stages.
- Public class TSDoc now distinguishes the absent/zero implicit 1,000-row cap
  from positive ordered limits. Security artifacts name runtime basis
  `ffd8549e`, its immutable review package, and the corrected package README
  evidence path without claiming security acceptance.
- The focused lifecycle command exited 0 with 21 passed/99 skipped; the full
  native SpineServices file exited 0 with 120/120. A final combined run of the
  three new cases exited 0 with 3 passed/117 skipped.
- `typecheck:generated` exited 0. `docs:check` exited 0 with 25 copied Proto
  checksums and API counts `100/28/205/19/17/3`. Focused ESLint initially
  reported one void-arrow brace style error; after the brace-only correction,
  ESLint and seven-file Prettier checks exited 0. Status/provenance/path/TSDoc
  scans match the pending-review contract, generated output is untracked, and
  `git diff --check` exited 0.

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

## Canonical Wave 2 Fix Implementation

- Existing implementer `019f62d7-31cc-7c13-a0b1-61d25dff9e23` completed the
  three-item batch with actual immutable `gpt-5.6-terra` / medium, no subagents,
  and no Git state mutation.
- The Set remains the authoritative per-instance capacity collection. Private
  owner tokens prevent ID-only release, and paused recovery cancellation
  retains its token through CAS settlement and durable deletion before release.
  Cancellation is checked immediately after CAS with no await before a possible
  synchronous remember.
- Focused RED exited 1 with 1 failed/115 skipped because cancellation admitted
  a distinct subscription while the only recovery slot was still owned. One
  intermediate post-fix run timed out because the test incorrectly expected
  deletion before recovery settlement; the corrected schedule produced GREEN
  with 1 passed/115 skipped. Cleanup-failure coverage passed 1/1, and the
  focused lifecycle set passed 18/18.
- Public TSDoc, user/package docs, and security artifacts now state that each
  `SpineServices` instance has an independent limit. Threat/findings provenance
  uses fixed baseline `39f2c6f7` and delegates immutable endpoints to the
  T-0041 records without a moving hash.
- Full native SpineServices passed 117/117. Generated build/tooling typechecks,
  docs/API validation, focused ESLint, wording/provenance scans, and formatting
  plus diff integrity are green. Canonical re-review, dedicated security
  re-review, and task closure remain pending.

## Wave 4 Coordinator Retry Finding

- Fresh coordinator native verification passed the focused ownership/capacity
  set 9/9 and full `spine-services.test.ts` 130/130. Generated/tooling
  typecheck, docs/API checks with counts `100/28/205/19/17/3`, focused ESLint,
  12-file Prettier, and `git diff --check` also passed.
- Source inspection found one uncovered high-confidence failure path. A known
  local owner is always removed from `#claims` and its reservation released when
  cancellation rejects, even if storage failed before installing a cancel
  marker. Its exact persisted claim then remains, the same instance's retry
  misclassifies it as foreign, and new capacity is admitted before persistence
  settles. This contradicts D-0087.
- Resume existing implementer `019f62d7-31cc-7c13-a0b1-61d25dff9e23`, expected
  explicit immutable Terra Medium, for one RED/GREEN correction: retain local
  owner and reservation through failed persistent cancellation, allow same-ID
  retry to clean it, then release exactly once. Remove dead claim bookkeeping
  only if the focused behavior remains unchanged. Canonical/security re-review
  remains pending.

## Wave 4 Coordinator Retry Acceptance

- Existing implementer returned with actual immutable `gpt-5.6-terra` /
  medium, no subagents or Git mutation, and is closed.
- Coordinator source inspection confirmed failed active, inactive, and recovered
  cleanup retain inert local ownership and capacity until same-ID retry settles
  persistence. Dead claim settlement fields are removed.
- Fresh native retry regressions passed 3/3 and full
  `spine-services.test.ts` passed 133/133. `typecheck:generated`, `docs:check`,
  focused ESLint, 12-file Prettier, and `git diff --check` exited 0; docs retained
  25 Proto checksums and API counts `100/28/205/19/17/3`.
- Lightweight pre-review lint confirmed aligned statuses, unchanged public
  exports/generated contracts/manifests/locks, and honest no-lease/reclamation
  docs. One mechanical duplicated-policy item remains: share the two cancellation
  `Aborted` messages between error construction and conflict classification
  before packaging. Canonical/security review remains pending.

## Wave 4 Pre-Review Lint Assignment

- Resume existing `implementer` `019f62d7-31cc-7c13-a0b1-61d25dff9e23`,
  expected explicit immutable `gpt-5.6-terra` / medium, for a lint-only private
  refactor: share the two cancellation `Aborted` messages between error creation
  and conflict classification. No behavior/docs/public surface/Git mutation or
  subagents. Focused test, typecheck, ESLint, Prettier, and diff integrity are
  required before packaging.

## Wave 4 Pre-Review Lint Acceptance

- Existing implementer returned with actual immutable `gpt-5.6-terra` /
  medium, exact strings/codes unchanged, no subagents or Git mutation, and is
  closed.
- Fresh coordinator conflict tests passed 2/2 (131 skipped).
  `typecheck:generated`, focused ESLint/Prettier, one-occurrence literal scans,
  and `git diff --check` exited 0.
- The endpoint is ready for one fresh immutable package and canonical review
  wave 5. Dedicated security review remains pending until canonical concerns
  are clean.

## Canonical Review Wave 5 Assignment

- Immutable endpoint `b4274b06`; package
  `.superpowers/sdd/review-39f2c6f7..b4274b06.diff` contains 25 commits and
  401,247 bytes.
- Dispatch existing style/maintainability reviewer with explicit immutable
  `gpt-5.6-terra` / high; documentation reviewer with explicit immutable
  `gpt-5.6-luna` / medium; TypeScript/API reviewer with explicit immutable
  `gpt-5.6-terra` / high; and performance/reliability reviewer with explicit
  immutable `gpt-5.6-terra` / high.
- Every lane is read-only, must attest actual profile metadata, perform its
  skill check, spawn no subagents or Git mutation, and ignore historical
  superseded text unless current records/docs claim it active. Review D-0087
  exact CAS ownership, all cleanup/failure paths, finite bounds, backward wire
  compatibility, public/internal boundaries, current docs, and tests. Aggregate
  all four results before fixes. Dedicated security review remains pending.

## Canonical Wave 5 Style Redispatch

- Style agent `019f63af-3c54-7b30-b0ba-32123ff926a9` is closed, but its result
  is invalid for acceptance because it explicitly could not attest actual model
  and reasoning metadata. Its 25 ms race-test observation remains advisory, not
  an accepted finding.
- Redispatch the same existing `style_maintainability_reviewer` role with
  explicit immutable `gpt-5.6-terra` / high, the identical package and bounded
  concern, and require verifiable actual metadata. Other wave 5 lanes continue;
  aggregate only valid complete results before fixes.

## Canonical Review Wave 5 Result

- The coordinator's multi-agent runtime schema confirms immutable role profiles
  and both explicit dispatch fields: style/API/reliability actual Terra High and
  documentation actual Luna Medium. This system metadata is authoritative even
  where a child's own workspace could not display it. The second style
  redispatch performed no review and is excluded; all agents are closed.
- Style agent `019f63af-3c54-7b30-b0ba-32123ff926a9`: one P1 test-determinism
  finding. Two recovery-blocking tests use a 25 ms race that can pass before the
  post-read gate is actually exercised.
- Documentation agent `019f63af-4027-7961-bab2-6ec6a2bd6138`: two P2 findings.
  Threat-model line anchors are stale, and public docs omit exact `INTERNAL`
  cancellation failure plus same-ID retry guidance.
- TypeScript/API agent `019f63b1-fdc3-7aa3-a3a1-a95d39e9c868`: one P1 codec
  finding. Permissive Base64 can turn malformed payloads into decodable empty
  subscriptions, and embedded subscription ID is not required to match the
  durable record ID, contradicting inert-malformed behavior and permitting
  mismatched delivered metadata.
- Reliability agent `019f63af-437a-7242-89e1-5dbef9a5684d`: one P1 ambiguous
  persistence finding. `write()` may commit then reject; the subscribe catch
  releases capacity before suppressed cleanup failure, leaving unbounded
  unreturned durable IDs.
- Return the complete five-item batch to the existing Terra Medium implementer
  with behavior-first tests, no subagents/Git mutation, and current docs/logs.
  Dedicated security review remains pending.

## Canonical Wave 5 Fix Result

- Existing implementer `019f62d7-31cc-7c13-a0b1-61d25dff9e23`, actual
  immutable runtime `gpt-5.6-terra` / medium, is applying receiving-review and
  strict TDD guidance directly without subagents or Git-state mutation.
- Ambiguous-persistence RED: `pnpm --config.verify-deps-before-run=false exec
vitest run packages/server/test/services/spine-services.test.ts -t 'retains
ambiguous persistence until inactive cleanup settles'` exited 1 with 1
  failed/133 skipped because a second subscription was admitted instead of
  receiving `ResourceExhausted` after commit-then-reject plus cleanup-read
  failure.
- The subscribe failure path now preserves the originating error, closes and
  retains inert local cleanup ownership and its reservation when durable
  cancellation cannot settle, and uses the retained inactive timer for one
  internal cleanup retry. Focused GREEN for the same command exited 0 with 1
  passed/133 skipped. At that checkpoint, the remaining wave 5 fixes had not
  yet been applied.
- Strict-codec RED: the focused `keeps noncanonical and ID-mismatched inactive
records inert` command exited 1 with 1 failed/134 skipped because recovery
  attempted one claim CAS for a noncanonical payload. Canonical Base64 and
  exact embedded-ID binding are now required before decode/recovery mutation;
  the identical GREEN exited 0 with 1 passed/134 skipped. Direct malformed
  codec coverage also includes alphabet, length/padding, canonical re-encoding,
  and missing embedded ID.
- The two removal-gate regressions passed 2/2 (133 skipped) before conversion
  and again after replacing both 25 ms negative races with deterministic
  pre-read/post-read barriers plus microtask settlement checks. No production
  timing option or test-only public seam was added.
- Public cancellation retry wording and current tenant/restored-tenant threat
  anchors are updated. Status is wave 5 fixes implemented; coordinator
  verification, canonical review, dedicated security re-review, and task
  closure remain pending.
- Final focused wave 5 command passed 5/5 with 130 skipped. The broader
  claim/cancel/codec/ambiguous-write lifecycle command hit sandbox-only
  `listen EPERM` after 41 passes, then passed natively with 42/42 and 93
  skipped. The final native `spine-services.test.ts` rerun passed 135/135.
- Final `typecheck:generated` exited 0. `docs:check` exited 0 with 25 copied
  Proto checksums and TypeDoc counts `100/28/205/19/17/3`. Focused ESLint and
  Prettier checks exit 0 after correcting two test-fixture lint findings. Final
  status/provenance/anchor/residual scans matched the pending-review contract;
  public-export, retired-race, generated-tracking, and manifest/lock/package-root
  scans returned no matches. `git diff --check` exited 0.

## Wave 4 Coordinator Retry RED

- Existing implementer `019f62d7-31cc-7c13-a0b1-61d25dff9e23`, actual
  immutable runtime `gpt-5.6-terra` / medium, resumed directly with no
  subagents or Git-state mutation.
- `pnpm --config.verify-deps-before-run=false exec vitest run
packages/server/test/services/spine-services.test.ts -t 'retains an active
owner and capacity after pre-marker cancellation failure'` exited 1 with 1
  failed/130 skipped. The first cancellation returned the required `Internal`,
  but a distinct subscribe did not throw `ResourceExhausted`, proving the local
  reservation was released before persistent cancellation settled.

## Wave 4 Coordinator Retry Fix

- Known local records, owner claims, and normal reservations now release only
  after persistent cancellation succeeds. Failed settlement restores a closed
  local record as inert cleanup ownership and retains any exact owner token for
  same-ID retry. Unknown-removal slots still release on every result.
- Recovered-registration rollback preserves its originating error. Successful
  owned-claim cleanup releases locally; failed cleanup retains the claim and
  reservation so later same-ID cancel can settle it.
- Focused GREEN for the original active-claim command exited 0 with 1 passed/130
  skipped. Active, inactive, and recovered-registration failure cases passed
  together 3/3 (130 skipped); the relevant lifecycle set passed 35/35 (98
  skipped); full native `spine-services.test.ts` passed 133/133.
- Dead `SubscriptionClaim` remembered/settled callback state was removed. No
  public API, storage interface, generated contract, package export, manifest,
  lockfile, or policy documentation changed. Status is coordinator retry fixed;
  coordinator re-verification and canonical/security review remain pending.

## Wave 4 Pre-Review Lint Fix

- Existing implementer `019f62d7-31cc-7c13-a0b1-61d25dff9e23`, actual
  immutable runtime `gpt-5.6-terra` / medium, replaced the two duplicated
  cancellation `Aborted` policy literals with private shared constants used by
  both error factories and `isCancellationConflict()`.
- The narrow characterization command passed before and after the refactor with
  2 passed/131 skipped. Exact messages, `Code.Aborted`, runtime behavior, docs,
  tests, public/generated APIs, exports, manifests, and locks are unchanged.
- Status is pre-review lint fixed; coordinator verification and canonical/
  dedicated security review remain pending.
- Final `typecheck:generated`, focused ESLint, four-file Prettier, literal-count
  scan, and `git diff --check` exited 0; the final focused test rerun remained
  2 passed/131 skipped.

## Wave 5 Coordinator Verification

- The coordinator inspected the complete ten-file diff. Ambiguous committed
  subscription writes now retain a closed local record and its reservation
  when immediate durable cancellation cannot settle; the existing inactive
  timer retries exact cleanup. Strict inactive decoding rejects noncanonical
  Base64 and embedded/durable subscription-ID mismatch before recovery CAS.
- Fresh native focused verification passed 5/5 with 130 skipped, covering the
  ambiguous-write regression, strict codec and ID binding, both deterministic
  cancellation/recovery barriers, and direct malformed-record validation.
  Fresh native full affected-file verification passed 135/135.
- `typecheck:generated`, `docs:check`, focused ESLint, ten-file Prettier, and
  `git diff --check` exited 0. TypeDoc retained expected public counts
  `100/28/205/19/17/3` and the Proto workflow verified 25 copied checksums.
- The lightweight pre-review status/provenance, duplicate-policy,
  public-export, manifest/lock, generated-output, future-policy, and threat
  anchor scans found no changed-surface drift. Canonical wave 6 and the
  dedicated security re-review remain pending; T-0041 is not complete.

## Canonical Review Wave 6 Assignment

- Wave 5 fixes are committed at immutable endpoint `113934d2`; review package
  `.superpowers/sdd/review-39f2c6f7..113934d2.diff` contains 29 commits and
  439,772 bytes from baseline `39f2c6f7`.
- Dispatch all four existing canonical roles read-only with explicit immutable
  profiles: `style_maintainability_reviewer`, `gpt-5.6-terra` / high;
  `documentation_reviewer`, `gpt-5.6-luna` / medium;
  `typescript_api_docs_reviewer`, `gpt-5.6-terra` / high; and
  `performance_reliability_reviewer`, `gpt-5.6-terra` / high.
- Each reviewer owns only its named concern, must inspect the current task
  ledger and changed execution paths, must not spawn subagents or mutate Git,
  and must ignore superseded historical text unless a current status or changed
  public document claims it as active. Aggregate the complete wave before any
  fix. Dedicated security review remains pending.

## Canonical Review Wave 6 Result And Fix Assignment

- Style/maintainability agent `019f63cf-f179-7bd1-8c33-30ddeba05379`, actual
  immutable `gpt-5.6-terra` / high, found P1: if initial registration, durable
  cleanup, and the retained timer registration all fail, the unreturned closed
  record has no remaining cleanup owner and permanently holds capacity.
- Documentation agent `019f63cf-eaa8-7132-b83a-929936409252`, actual immutable
  `gpt-5.6-luna` / medium, found Low: threat-model provenance still says the
  wave 5 endpoint lacks a commit although `113934d2` now freezes it.
- TypeScript/API agent `019f63cf-ee39-7672-b539-3405844fae99`, actual immutable
  `gpt-5.6-terra` / high, found Medium: API and architecture docs say every
  unordered limit is invalid, but absent/zero wire limits receive the implicit
  1,000-row cap; only positive limits require ordering.
- Performance/reliability agent `019f63d2-24ea-7570-b5e3-50ba4e2a1a95`, actual
  immutable `gpt-5.6-terra` / high, reported clean after tracing bounds, CAS
  orderings, malformed-row handling, and lifecycle cleanup. All four agents
  are closed; explicit dispatch matched immutable runtime metadata.
- Assign one fresh existing `implementer` role with explicit immutable
  `gpt-5.6-terra` / medium because the prior implementation context is closed.
  It owns the complete three-item TDD/docs/log fix, must not spawn subagents or
  mutate Git, and must preserve public/wire contracts and finite cleanup.
  Canonical re-review and dedicated security review remain pending.

## Canonical Review Wave 6 Fix

- Existing `implementer`, explicit immutable `gpt-5.6-terra` / medium, is the
  sole writer in the assigned existing worktree with no subagents or Git-state
  mutation.
- RED: the deterministic combined timer/persistence regression exited 1 with
  one timeout because no cleanup began after a commit-then-reject Subscribe,
  failed initial cancellation, and two timer-registration failures.
- GREEN: the identical focused command exited 0 with 1 passed/135 skipped. A
  private one-shot microtask invokes existing exact cancellation only when the
  retained timer cannot register; it preserves the originating Subscribe error,
  keeps the closed record inert and capacity-reserved until cancellation settles,
  and cannot spin.
- Public API/architecture docs now state that absent/zero wire query limits use
  an implicit 1,000-row cap and only positive unordered limits are
  `INVALID_QUERY`. Threat-model provenance names immutable Wave 5 endpoint
  `113934d2`; canonical and dedicated security review remain pending.
- `typecheck:generated` and `docs:check` exited 0. Focused ESLint, exact-file
  Prettier, pre-review provenance/generated-output scans, and `git diff --check`
  are clean. The full affected SpineServices file is sandbox-blocked only:
  117 tests passed, while 19 real-gRPC tests failed at loopback bind with
  `listen EPERM: operation not permitted 127.0.0.1`; coordinator native rerun
  remains required.

## Wave 6 Coordinator Verification

- Direct inspection confirms the fallback queues exactly one existing removal
  attempt only when retained timer registration fails. The local record remains
  closed and reserved until exact cancellation succeeds; a failed fallback is
  retained without another automatic attempt, so there is no retry spin.
- Fresh native focused verification passed 1/1 with 135 skipped. Fresh native
  full `spine-services.test.ts` verification passed 136/136, resolving the
  worker's sandbox-only loopback limitation.
- Fresh `typecheck:generated`, `docs:check`, focused ESLint, eight-file
  Prettier, current-status/public-policy/generated-output scans, and
  `git diff --check` exited 0. Docs verified 25 copied Proto checksums and
  TypeDoc public counts `100/28/205/19/17/3`.
- The complete Wave 6 fix batch is accepted for commit and immutable canonical
  Wave 7 review. Dedicated security review and T-0041 closure remain pending.

## Canonical Review Wave 7 Assignment

- Wave 6 fixes are committed at immutable endpoint `6f45be80`; review package
  `.superpowers/sdd/review-39f2c6f7..6f45be80.diff` contains 32 commits and
  474,837 bytes from baseline `39f2c6f7`.
- Dispatch all four existing canonical roles read-only with explicit immutable
  profiles: style/maintainability Terra High, documentation Luna Medium,
  TypeScript/API Terra High, and performance/reliability Terra High.
- All concerns remain relevant because the batch changed private cleanup
  behavior, deterministic tests, public API/architecture wording, security
  provenance, and durable status. Require ledger inspection, no subagents/Git
  mutation, exact file/line findings, and the superseded-history exclusion.
  Aggregate the complete wave before any fix. Dedicated security review remains
  pending.

## Canonical Review Wave 7 Result And Split Assignment

- Style agent `019f63e2-6f10-7522-b963-afe45db0c852`, actual immutable Terra
  High, found P1 missing bounded failure/no-spin evidence for the timerless
  fallback. Documentation agent `019f63e2-6bf0-7b62-9bfb-933f733d1a98`, actual
  immutable Luna Medium, found Low stale security-artifact endpoint provenance.
  TypeScript/API agent `019f63e2-723b-76e0-887b-9fbca2ac27d1`, actual immutable
  Terra High, reported clean. Reliability agent
  `019f63e4-1ac9-7213-917b-02076c8f6bee`, actual immutable Terra High, found
  three P1s. Every reviewer is closed and explicit dispatch matched runtime.
- Deduplicated batch: (1) reconcile commit-then-reject claim CAS without
  abandoning an exact persisted owner; (2) prevent transient failure of the
  timerless fallback from permanently consuming an unreturned slot while
  preserving finite/no-spin policy and add bounded evidence; (3) reject public
  ZeroMQ request timeouts that permit an indefinitely blocked request/close;
  and (4) anchor both security artifacts to substantive endpoint `6f45be80`.
- These findings change persistence/concurrency and a public option contract.
  Assign the existing `requirements_splitter` with explicit immutable
  `gpt-5.6-sol` / high to define the smallest compatible TDD contracts and
  review-lane impact. It is read-only, must not spawn subagents or mutate Git,
  and must preserve D-0087, finite cleanup, no public scheduler, exact type
  URLs, and accepted stale-claim residuals.

## Wave 7 Requirements Split And Implementation Assignment

- Requirements splitter `019f63ea-f80b-7291-bf00-4f6f704b119b`, actual
  immutable `gpt-5.6-sol` / high, completed read-only and is closed. Local Spine
  JVM notes confirmed the familiar opaque Subscribe/Activate/Cancel lifecycle;
  the referenced source checkout was unavailable, so no broader JVM behavior is
  inferred.
- Clarify D-0087: reconcile one ambiguous claim CAS using the same storage
  handle. Adopt only the exact proposed claim; exact prior inactive propagates
  the original error and releases; changed/absent state uses existing loss/
  cancellation semantics; unreadable/unparseable outcome retains the exact
  owner token and reservation inertly for same-instance cancellation.
- Timerless failed setup uses one scheduled private runner with exactly two
  sequential exact cancellation attempts. Success releases; exhaustion retains
  one inert bounded slot with no repeat, recursion, timer, or spin. The complete
  path has at most three cleanup attempts including the initial one.
- Add D-0088: omitted ZeroMQ `requestTimeoutMs` remains 2,000; accepted explicit
  values are integers 1..2,147,483,647. Reject all other values synchronously
  with exact `TypeError` before filesystem/socket work. `receiveTimeoutMs` and
  active request cancellation remain out of scope.
- Security artifacts anchor substantive evidence to `6f45be80`. Assign one
  fresh existing `implementer`, explicit immutable `gpt-5.6-terra` / medium,
  for the complete four-slice TDD/docs/decision/log batch. It must not spawn
  subagents or mutate Git and must keep private names within four semantic
  components. All four canonical lanes rerun afterward.

## Wave 7 Implementer Progress

- Existing implementer is the sole writer with explicit immutable
  `gpt-5.6-terra` / medium dispatch, no subagents, and no Git-state mutation.
- Deterministic RED/GREEN covers ambiguous exact claim adoption and
  reconciliation-read failure retained for same-instance cancellation; timerless
  retained cleanup now has a two-attempt runner budget after the initial failed
  cancellation; and invalid ZeroMQ request timeout values fail synchronously
  before IPC preparation. Final focused/native validation remains pending.

## Wave 7 Coordinator Native Test Correction

- Fresh native server selection passed 4/4 with 136 skipped.
- Native ZeroMQ timeout/close selection executed both tests successfully but
  exited 1 because the unanswered request rejected with `EAGAIN` during
  `close()` before the test attached its later assertion; Vitest reported one
  unhandled rejection and `PromiseRejectionHandledWarning`.
- Return this bounded test-only correction to implementer
  `019f63f4-5b91-7a53-bcdc-9f626ee6bf28`, explicit immutable Terra Medium.
  Attach a rejection observer immediately when creating the request, preserve
  the sent-request/close ordering and assertions, rerun focused native evidence,
  and update durable logs. No production or contract change is assigned.

## Wave 7 Native Test Correction Progress

- The resumed immutable Terra Medium implementer attached a rejection observer
  when the request promise is created, while retaining the handler-started proof,
  separate close harness deadline, and direct rejected-request assertion.
- The invalid-timeout table now explicitly includes `-2` and `-Infinity`.
  Production code, documentation, decisions, and contracts are unchanged;
  the exact native focused command passes 2/2 with no unhandled rejection.
  Focused ESLint, exact-file Prettier, and diff integrity are clean.

## Wave 7 Coordinator Verification

- Direct inspection accepts exact claim reconciliation and explicit
  outcome-unknown retention, the one-runner/two-attempt timerless budget,
  D-0088 request-timeout validation, docs, security provenance, and the corrected
  immediate request-rejection observer.
- Fresh native claim/timerless selection passed 4/4 with 136 skipped; corrected
  native timeout/close selection passed 2/2 with 29 skipped and no warning.
  Fresh full native `spine-services.test.ts` passed 140/140 and full native
  `signal-transport.test.ts` passed 31/31.
- Fresh `typecheck:generated`, `docs:check`, focused four-file ESLint, exact
  twelve-file Prettier, status/provenance/public-policy/generated/manifest scans,
  and `git diff --check` exited 0. Docs verified 25 copied Proto checksums and
  TypeDoc counts `100/28/205/19/17/3`.
- Accept the substantive batch for commit. After its hash exists, update only
  durable provenance to name that implementation endpoint, then package and run
  canonical Wave 8. Dedicated security review and T-0041 closure remain pending.

## Wave 7 Immutable Implementation Endpoint

- Commit `732409ff` contains the complete coordinator-verified Wave 7
  implementation, decisions, tests, public docs, security-state updates, and
  durable evidence.
- Security provenance now names `732409ff` as the substantive implementation
  endpoint. This provenance-only follow-up and later review/status commits are
  explicitly not implementation evidence. Canonical Wave 8 packaging and
  dedicated security review remain pending.

## Canonical Review Wave 8 Assignment

- Immutable review endpoint `ed1d26c1`; package
  `.superpowers/sdd/review-39f2c6f7..ed1d26c1.diff` contains 37 commits and
  517,271 bytes. Substantive implementation endpoint remains `732409ff`.
- Dispatch all four existing canonical roles read-only with explicit immutable
  profiles: style/maintainability Terra High, documentation Luna Medium,
  TypeScript/API Terra High, and performance/reliability Terra High.
- Require ledger/current-decision inspection, exact affected paths, no
  subagents or Git mutation, concrete file/line findings, and superseded-history
  exclusion. Stress claim-CAS ambiguity, finite timerless cleanup, request-
  timeout/close boundedness, public docs, and stable security provenance.
  Aggregate the complete wave before action; dedicated security review remains
  pending.

## Canonical Review Wave 8 Result And Fix Assignment

- The complete wave is accepted. Style/maintainability found two P2 items:
  isolate the D-0087 claim-CAS error reconciliation from the 42-line
  `#claimDurable()` method, and make the sent-unanswered-request liveness test
  prove the configured 25 ms timeout with a materially smaller derived deadline
  plus native scheduling margin. Documentation found one medium item: complete
  `docs/api/README.md` with the public `subscriptionLimit` default/bounds,
  separate unknown-ID cancellation pool, and known-local cancellation
  persistence failure/capacity-retention contract. TypeScript/API and
  performance/reliability are clean.
- Dispatch evidence was explicit and tool-enforced by immutable role profiles:
  style `019f6407-a559-73d1-be8d-3829fd813fde` Terra High; documentation
  `019f6407-a1e7-7ad3-ad96-1614d780e33f` Luna Medium; TypeScript/API
  `019f6407-a934-76c2-8db9-8f963766b6df` Terra High; reliability
  `019f6409-5565-7453-a831-0ad9fa094812` Terra High. The child-visible generic
  display label exposed no finer profile, so the Desktop role configuration and
  successful explicit dispatch are the actual immutable runtime evidence. All
  four reviewers are closed.
- Assign one fresh existing `implementer`, explicit immutable Terra Medium,
  because the prior implementation context is closed. Its bounded write scope
  is `spine-services.ts`, its focused service test only if needed to preserve
  behavior, `signal-transport.test.ts`, `docs/api/README.md`, and these durable
  logs. It must use TDD where behavior changes, run focused tests/lint/format,
  avoid Git mutation and subagents, and report exact evidence. All four
  canonical lanes rerun afterward; dedicated security review remains pending.

## Wave 8 Fix Implementation Progress

- The existing senior TypeScript implementer, runtime profile `gpt-5.6-terra`
  / medium, is the sole writer for this batch. No subagents or Git-state
  mutation were used. The D-0087 source change is behavior-preserving: its
  focused claim/recovery/cancellation reconciliation regressions passed 6/6.
- `#claimDurable()` now delegates CAS-error reconciliation to the private
  `#reconcileClaimError()` semantic method. The method preserves exact proposed
  claim adoption, original-error propagation for the prior inactive state,
  lost/canceled outcomes, and unknown-ownership retention on read/decode
  failure.
- The sent-unanswered-request test keeps immediate rejection observation and
  sent-before-close ordering, but its 275 ms close deadline is now the
  configured 25 ms request timeout plus a 250 ms native scheduling margin.
  The focused native IPC run is environment-blocked before assertion by
  `Operation not permitted`; it is not a behavior failure.
- The API overview now documents the public default-100 positive-safe-integer
  per-instance subscription bound, separate same-sized unknown-ID cancellation
  pool, and known-local `INTERNAL` persistence-failure/capacity-retention/
  same-ID retry contract. It does not promise stale-claim cleanup.

## Wave 8 Fix Coordinator Verification

- Direct diff inspection accepts the behavior-preserving D-0087 helper
  extraction, the derived 275 ms liveness deadline, and the completed public API
  capacity/failure text. No unrelated or generated tracked files changed.
- Fresh focused D-0087 verification passed 6/6. Fresh native verification of the
  tightened ZeroMQ test passed 1/1 in 34 ms. The complete two affected native
  suites then passed 171/171 (`spine-services.test.ts` 140 and
  `signal-transport.test.ts` 31).
- Fresh `typecheck:build:generated`, `docs:check`, focused ESLint, exact six-file
  Prettier, and `git diff --check` all exited 0. Docs verified 25 Proto source
  checksums and TypeDoc export counts `100/28/205/19/17/3`. Accept this bounded
  batch for commit; canonical Wave 9 and dedicated security review remain.

## Wave 8 Immutable Implementation Endpoint

- Commit `430b1eaf` contains the coordinator-verified Wave 8 source refactor,
  tightened liveness regression, public API documentation, and durable evidence.
- Security provenance now names `430b1eaf` as substantive implementation
  evidence. This provenance-only follow-up and later review/status commits are
  not implementation evidence. Generate a literal package from `39f2c6f7` after
  this reconciliation, then run all four canonical Wave 9 lanes. Dedicated
  security review remains pending.

## Canonical Review Wave 9 Assignment

- Immutable review endpoint `173bf3b4`; package
  `.superpowers/sdd/review-39f2c6f7..173bf3b4.diff` contains 41 commits and
  537,157 bytes. Substantive implementation endpoint remains `430b1eaf`.
- Dispatch all four existing canonical roles read-only with explicit immutable
  profiles: style/maintainability Terra High, documentation Luna Medium,
  TypeScript/API Terra High, and performance/reliability Terra High. Require the
  complete task ledger, D-0087/D-0088, exact package/affected paths, no
  subagents or Git mutation, concrete findings or clean, and superseded-history
  exclusion. Focus re-review on the three Wave 8 corrections while retaining
  project-wide T-0041 scope. Aggregate the complete wave before action;
  dedicated security review remains pending.

## Canonical Review Wave 9 Result And Correction Split

- The complete wave is accepted. Style/maintainability is clean. Documentation
  found two P2 architecture-guide defects: missing default-100 instance-local
  `subscriptionLimit` and retained-capacity failure semantics, plus an overbroad
  claim that duplicate cancellations always return OK. TypeScript/API found
  three P2 defects: the published `@spine-ts/transport/zeromq` subpath is absent
  from TypeDoc/export gating; internal `onBackgroundFailure` leaks through the
  public options declaration; and `inactiveTtlMs` TSDoc incorrectly says durable
  inactive records are process-local. Performance/reliability found one P2: the
  liveness test's cleanup can await the same hung close indefinitely and does
  not prove request settlement precedes close completion.
- Explicit immutable Desktop profiles are tool-enforced runtime evidence:
  style `019f6416-2697-75c0-910f-ded1eb50e4a3` Terra High; documentation
  `019f6416-2da4-7af3-83a6-043968dfeeb3` Luna Medium; TypeScript/API
  `019f6416-2a30-7d11-bc33-ea36620c6afd` Terra High; reliability
  `019f6418-0b76-77a2-b4e0-dc3eaaf94c91` Terra High. Child-visible sessions
  exposed no finer profile metadata. All four reviewers are closed.
- Because correcting a leaked public option and adding subpath API coverage are
  public-contract design work, dispatch the existing requirements splitter with
  explicit immutable Sol High. It must define the smallest compatibility-safe
  correction, test-only/background-failure observation seam, exact TypeDoc gate
  shape, liveness assertions/cleanup bound, docs alignment, affected tests, and
  no-scope-expansion constraints. It is read-only, cannot spawn subagents or
  mutate Git, and must return one bounded implementation contract. Dedicated
  security review remains pending.

## Canonical Wave 9 Correction Contract And Implementation Assignment

- Requirements splitter `019f641c-1ec1-7773-a774-e1354130ec56`, explicit
  immutable Sol High, returned one bounded contract without subagents, file
  mutation, or Git mutation and is closed. D-0089 records the accepted public
  decision: remove `onBackgroundFailure` from `ZeroMqTransportOptions`, retain
  behavior through a non-exported internal/test structural option, and do not
  create a public monitoring subsystem.
- Add `packages/transport/src/zeromq/index.ts` as a distinct TypeDoc entry point
  and gate exactly six subpath symbols plus absence of the private observer.
  Root transport remains 17; docs reporting becomes
  `100/28/205/19/17/6/3`. Package exports remain unchanged.
- Strengthen the native liveness test to record exact `request-settled` then
  `close-complete` order, retain the 275 ms bound, independently bound fixture
  cleanup, and always attempt directory removal. Correct `inactiveTtlMs` TSDoc
  and architecture capacity/cancellation wording exactly to current behavior.
- Assign one fresh existing `implementer`, explicit immutable Terra Medium, as
  sole writer. It owns only affected transport/server source/tests, TypeDoc/API
  checker/docs, D-0089 and these logs. It must preserve all runtime contracts,
  package/Proto/dependency/generated boundaries, use RED/GREEN for public type
  and API gates, run focused native evidence where possible, and avoid Git
  mutation and subagents. All four canonical lanes rerun afterward; dedicated
  security review remains pending.

## Canonical Wave 9 Implementer Start

- The assigned existing sole implementer has started the bounded D-0089
  correction under the required explicit `gpt-5.6-terra` / medium runtime
  profile, with no subagents and no Git mutation. RED coverage now asserts the
  public two-key options surface and missing direct ZeroMQ TypeDoc/source gate;
  RED execution and then minimal GREEN evidence are recorded in the work and
  review logs. Dedicated security review remains pending.

## Canonical Wave 9 GREEN Status

- D-0089 implementation is green under focused evidence: the public ZeroMQ
  options type has two exact keys, TypeDoc directly gates the six-symbol subpath
  with counts `100/28/205/19/17/6/3`, native transport/cross-process tests pass,
  and stale TSDoc/architecture wording is corrected. The native IPC sandbox
  limitation and approved rerun are recorded in the work log. Final focused
  hygiene reruns and canonical review dispositions remain pending; dedicated
  security review remains pending.

## Canonical Wave 9 Coordinator Verification

- Direct inspection accepts the D-0089 public/internal type boundary, exact
  six-symbol direct ZeroMQ TypeDoc/source gate, ordered and independently
  bounded liveness cleanup, durable inactive-TTL TSDoc, and architecture
  capacity/cancellation wording. Generated declarations expose only the two
  public timeout options and contain no `onBackgroundFailure`.
- Fresh native affected suites passed 38/38: transport 31 and cross-process
  server 7. Fresh generated typecheck, docs/API generation, generated-clean
  check, focused ESLint, exact ten-file Prettier, manifest/lock/package-map
  integrity, tracked-generated absence, and `git diff --check` all exited 0.
  Docs verified 25 Proto checksums and exact counts `100/28/205/19/17/6/3`.
- Accept the complete correction for commit. Canonical Wave 10 and dedicated
  security review remain pending.

## Wave 9 Immutable Implementation Endpoint

- Commit `45fd5583` contains the coordinator-verified D-0089 public/internal
  options correction, direct ZeroMQ API gate, liveness proof, docs corrections,
  and durable evidence.
- Security provenance now names `45fd5583` as substantive implementation
  evidence. This provenance-only follow-up and later review/status commits are
  not implementation evidence. Generate a literal baseline package after this
  reconciliation, then run all four canonical Wave 10 lanes. Dedicated security
  review remains pending.

## Canonical Review Wave 10 Assignment

- Immutable review endpoint `c91d8bb5`; package
  `.superpowers/sdd/review-39f2c6f7..c91d8bb5.diff` contains 46 commits and
  577,389 bytes. Substantive implementation endpoint remains `45fd5583`.
- Dispatch all four existing roles read-only with explicit immutable profiles:
  style/maintainability Terra High, documentation Luna Medium, TypeScript/API
  Terra High, and performance/reliability Terra High. Require the full ledger,
  D-0087 through D-0089, current security artifacts, exact package/affected
  paths, no subagents or Git mutation, concrete findings or clean, and
  superseded-history exclusion. Re-review all Wave 9 corrections and retain the
  complete T-0041 milestone scope. Aggregate the full wave before action;
  dedicated security review remains pending.

## Canonical Review Wave 10 Result And Fix Assignment

- Complete accepted wave: documentation found three P2 gaps for expiry-cleanup
  failure retention/no automatic retry, per-instance same-ID cancellation scope,
  and incomplete six-symbol ZeroMQ subpath descriptions. TypeScript/API found
  one P2 stale class TSDoc sentence calling durable inactive records
  process-local. Style found one P2 unknown-cancel `OK` overclaim under pool
  exhaustion and one P3 naming/duplicate-deadline/diagnostic hygiene issue.
  Reliability found one P2 missing regression that a throwing internal observer
  is swallowed while later delivery continues.
- Tool-enforced immutable runtime profiles: style
  `019f6432-2b8e-7571-84e2-f1760b376bd7` Terra High; docs
  `019f6432-27ca-7ac3-b353-660f6f61ee1f` Luna Medium; API
  `019f6432-2ef4-7893-ac23-ab296761a92a` Terra High; reliability
  `019f6434-9e06-7ff1-9989-4b127fbb5b32` Terra High. Child sessions exposed no
  finer profile metadata. All four reviewers are closed.
- Assign one fresh existing `implementer`, explicit immutable Terra Medium, as
  sole writer. This is a bounded docs/test/name correction, not public-contract
  redesign: align architecture/API/server/transport docs and class TSDoc; rename
  every new Wave 9 identifier exceeding four semantic components; share one 275
  ms test deadline; reflow the API diagnostic; and make the existing subscriber
  recovery test's observer throw while proving later delivery. No production
  behavior, public names, exports, package/Proto/dependency/generated policy, or
  D-0087/D-0088/D-0089 change is authorized. Run focused native and docs/type/
  lint/format checks; no Git mutation or subagents. All four canonical lanes
  rerun afterward; dedicated security review remains pending.

## Canonical Review Wave 10 Correction

- The sole existing implementer corrected only the assigned docs/test/name
  batch. Class TSDoc now identifies durable inactive records and recovery before
  expiry; architecture, API, server, and transport docs now qualify cancellation
  admission/capacity, same-instance coalescing, expiry-cleanup retention/no
  automatic retry, explicit retry, and all six public ZeroMQ subpath names.
- The existing subscriber-recovery regression now records its `Error` and
  throws from the internal observer while later delivery still completes. One
  shared test-only 275 ms close deadline covers both close checks. Private Wave
  9 helper names and API-gate diagnostics were shortened and reflowed; public
  contracts, exports, runtime behavior, generated output, packages, and
  D-0087/D-0088/D-0089 remain unchanged.
- Fresh evidence: native transport test `31/31`, native cross-process server
  test `7/7`, generated build typecheck, docs check (25 Proto checksums and
  export counts `100/28/205/19/17/6/3`), focused ESLint, exact Prettier,
  generated-clean, manifest/lock diff inspection, and `git diff --check` all
  exited 0. The sandbox transport attempt was blocked by expected native IPC
  `EPERM`; the approved native rerun is the validation evidence.
- Assignment specifies `gpt-5.6-terra` / medium. This execution surface exposes
  no immutable runtime-profile metadata, and no child work was dispatched or
  accepted. No Git mutation occurred. Canonical re-review remains pending.

## Wave 10 Coordinator Naming Correction

- Coordinator inspection accepts the docs, throwing-observer regression, shared
  deadline, public/internal boundary, and all other shortened names. One assigned
  hygiene item remains: `missingDeclaredZeroMqExports` still has five semantic
  components. Resume the same immutable Terra Medium implementer context to
  rename only this private API-checker local (for example
  `missingZeroMqDeclarations`), update durable evidence, and rerun the API gate,
  focused ESLint/Prettier, and diff integrity. No other change is authorized.

## Wave 10 Coordinator Naming Correction Result

- Renamed only the private API-checker local and references from
  `missingDeclaredZeroMqExports` to `missingZeroMqDeclarations`. No source,
  documentation, test behavior, public API, package, generated policy, or
  runtime contract changed.
- Direct `node scripts/check-api-docs.mjs` exited 0 with exact export counts
  `100/28/205/19/17/6/3`. Focused ESLint and Prettier for the checker, followed
  by final Prettier over the checker and T-0041 logs, and `git diff --check`
  exited 0.
- The existing explicit immutable implementer assignment remains
  `gpt-5.6-terra` / medium. No subagent or Git mutation was used. Canonical
  re-review remains pending.

## Wave 10 Coordinator Verification

- The resumed immutable Terra Medium implementer completed the final private
  rename and is closed. Direct inspection accepts all docs, TSDoc,
  throwing-observer recovery, shared deadline, short private names, and API
  diagnostics without production/public contract change.
- Fresh native affected suites passed 38/38 (transport 31, cross-process server
  7). Fresh generated typecheck, docs/API generation, generated-clean check,
  focused ESLint, exact twelve-file Prettier, manifest/lock/package-map
  integrity, tracked-generated absence, and `git diff --check` all exited 0.
  Docs verified 25 Proto checksums and counts `100/28/205/19/17/6/3`.
- Accept the complete Wave 10 correction for commit. Canonical Wave 11 and
  dedicated security review remain pending.

## Wave 10 Immutable Implementation Endpoint

- Commit `5f5fbd74` contains the coordinator-verified docs/TSDoc, throwing-
  observer regression, private naming, shared deadline, API diagnostic, and
  durable evidence corrections.
- Security provenance now names `5f5fbd74` as substantive implementation
  evidence. This provenance-only follow-up and later review/status commits are
  not implementation evidence. Generate a literal baseline package after this
  reconciliation, then run all four Canonical Wave 11 lanes. Dedicated security
  review remains pending.

## Canonical Review Wave 11 Assignment

- Immutable review endpoint `d22946d2`; package
  `.superpowers/sdd/review-39f2c6f7..d22946d2.diff` contains 51 commits and
  604,131 bytes. Substantive implementation endpoint remains `5f5fbd74`.
- Dispatch all four existing roles read-only with explicit immutable profiles:
  style/maintainability Terra High, documentation Luna Medium, TypeScript/API
  Terra High, and performance/reliability Terra High. Require the full ledger,
  D-0087 through D-0089, current security artifacts, exact package/affected
  paths, no subagents or Git mutation, concrete findings or clean, and
  superseded-history exclusion. Re-review all Wave 10 corrections and retain
  complete T-0041 scope. Aggregate before action; dedicated security review
  remains pending.

## Canonical Review Wave 11 Result And Docs Fix Assignment

- Complete wave: style, TypeScript/API, and performance/reliability are clean.
  Documentation found three P2 mirror gaps: `docs/USER_GUIDE.md` omits unknown-
  removal pool exhaustion before storage and inactive-expiry cleanup failure
  retaining local record/capacity with no automatic retry; the later transport
  section of `docs/architecture/README.md` lists only the config helper and
  factory instead of all six ZeroMQ subpath names.
- Explicit immutable Desktop profiles: style
  `019f6447-b99d-7012-8ed6-a369ee72532e` Terra High; docs
  `019f6447-b5c5-7870-978a-0ac7487e2915` Luna Medium; API
  `019f6447-bd61-76e1-b127-50ad057aee45` Terra High; reliability
  `019f6449-cf0f-7662-bb0c-51e6f855e02a` Terra High. Child sessions exposed no
  finer profile metadata. All four reviewers are closed.
- Assign one fresh existing `implementer`, explicit immutable Terra Medium, for
  docs and durable logs only. Mirror current accepted wording exactly: unknown-
  pool overflow is `RESOURCE_EXHAUSTED` before storage; inactive-expiry cleanup
  failure retains local record/capacity after timer clearance with no automatic
  retry and explicit same-ID `Cancel` retry; architecture enumerates the same
  six public ZeroMQ names as API/transport docs. No runtime, test, public,
  package/Proto/dependency/generated, or policy change; no Git mutation or
  subagents. Run docs check, exact formatting, link/status scans, and diff
  integrity. All four canonical lanes rerun; security remains pending.

## Canonical Wave 11 Documentation Correction

- Corrected only the accepted documentation mirrors. The user guide now states
  that the separate same-sized unknown-ID pool returns `RESOURCE_EXHAUSTED`
  before storage when exhausted, keeps known-local `INTERNAL` retry guidance
  distinct, and records inactive-expiry cleanup failure after timer clearance as
  retained local record/capacity with no automatic retry; explicit same-ID
  `Cancel` can retry persistence cleanup. The later architecture transport
  section now lists exactly `createZeroMqAdapterConfig`,
  `createZeroMqTransport`, `ZeroMqAdapterConfig`,
  `ZeroMqAdapterConfigInput`, `ZeroMqTransportScope`, and
  `ZeroMqTransportOptions`, while retaining the adapter-neutral root and
  internal/native exclusions.
- No runtime, test, TypeScript API/public symbol, package/Proto/dependency,
  generated-output, D-0087/D-0089, or policy change was made. The only changed
  paths are the two assigned docs and the T-0041 task/work/review logs.
- Exact validation passed with `--config.verify-deps-before-run=false`:
  `pnpm docs:check` (25 copied Proto checksums; TypeDoc export counts
  `100/28/205/19/17/6/3`) and `pnpm proto:check-generated`; exact five-path
  Prettier, local Markdown-link target check, stale-wording scans,
  manifest/lock/package-map and generated-tracking cleanliness, and
  `git diff --check` also passed.
- Profile evidence is this assignment's explicit `gpt-5.6-terra` / medium
  existing implementer role. No subagent was dispatched, the surface exposed no
  finer immutable runtime metadata, and no Git mutation occurred. Canonical
  Wave 12 and dedicated security review remain pending.

## Canonical Wave 11 Docs Coordinator Verification

- Direct inspection accepts the exact unknown-pool, expiry-failure, explicit
  retry, and six-name wording; no new Markdown link was introduced and only the
  two assigned docs plus durable logs changed. The immutable Terra Medium
  implementer is closed.
- Fresh `docs:check` and `proto:check-generated` exited 0. Docs verified 25 Proto
  checksums and counts `100/28/205/19/17/6/3`. Exact five-file Prettier,
  current-status and required-wording scans, manifest/lock/package-map
  integrity, tracked-generated absence, and `git diff --check` exited 0.
- Accept the docs correction for commit. Canonical Wave 12 and dedicated
  security review remain pending.

## Wave 11 Immutable Implementation Endpoint

- Commit `a0f40f04` contains the coordinator-verified user-guide and later
  architecture mirror corrections plus durable evidence.
- Security provenance now names `a0f40f04` as substantive implementation/docs
  evidence. This provenance-only follow-up and later review/status commits are
  not implementation evidence. Generate a literal baseline package after this
  reconciliation, then run all four Canonical Wave 12 lanes. Dedicated security
  review remains pending.

## Canonical Review Wave 12 Assignment

- Immutable review endpoint `74665f82`; package
  `.superpowers/sdd/review-39f2c6f7..74665f82.diff` contains 55 commits and
  622,051 bytes. Substantive implementation/docs endpoint remains `a0f40f04`.
- Dispatch all four existing roles read-only with explicit immutable profiles:
  style Terra High, documentation Luna Medium, TypeScript/API Terra High, and
  reliability Terra High. Require full ledger, D-0087 through D-0089, current
  security artifacts, exact package/affected paths, no subagents or Git
  mutation, findings or clean, and superseded-history exclusion. Re-review Wave
  11 mirrors and complete T-0041 scope. Aggregate before action; dedicated
  security review remains pending.

## Canonical Review Wave 12 Result And Correction Assignment

- The complete Wave 12 result is accepted after coordinator source inspection.
  Documentation is clean. Style found missing public expiry-failure mirrors and
  the matching normal inactive-expiry regression. TypeScript/API found that the
  publisher incorrectly receives D-0088's request/reply-only timeout.
  Performance/reliability found unbounded shared ZeroMQ fixture close cleanup.
- Explicit immutable Desktop profiles: style
  `019f6457-5eb4-7530-ac6a-c8f1810ca278` Terra High; documentation
  `019f6457-57c6-7a33-94ec-6ea33d4f400a` Luna Medium; TypeScript/API
  `019f6457-5b04-73f0-bd12-cc3468d806de` Terra High; reliability
  `019f6459-5354-71b1-a19d-86c472a0e132` Terra High. The immutable role
  settings are runtime metadata; all four agents are closed.
- Assign one fresh existing `implementer`, expected explicit immutable
  `gpt-5.6-terra` / medium, as the sole writer for the complete bounded batch.
  Restore D-0088 by removing publisher `sendTimeout` while retaining bounded
  requester send/receive waits; add a test-first publisher-option regression;
  bound both shared fixture closes independently and retain directory-removal
  cleanup with a paused-preparation regression; add a fake-timer regression for
  normal inactive-expiry persistence failure retaining capacity without a new
  timer until same-ID `Cancel` succeeds; and mirror those semantics in API and
  server docs while consolidating duplicate unknown-pool wording. No public
  API, dependency, package, Proto, generated-output, or broader policy change
  is authorized. Run focused affected checks; all four canonical lanes rerun
  before dedicated security review.

## Canonical Wave 12 Correction TDD Evidence

- Status remains correction in progress. No Canonical Wave 13 or dedicated final
  security-review outcome is claimed here.
- RED: `pnpm --config.verify-deps-before-run=false exec vitest run
packages/transport/test/zeromq/signal-transport.test.ts -t 'does not give
publishers the request/reply timeout|bounds shared fixture cleanup when a
transport is paused during preparation'` exited 1: publisher observation saw
  `sendTimeout: 123`, and shared fixture cleanup reached the outer deadline.
- GREEN: the identical transport command exited 0 with 2 passed/31 skipped after
  publisher construction stopped receiving `requestTimeoutMs` and each shared
  close received the existing 275 ms harness deadline while `rm()` remains in
  `finally`.
- The normal inactive-expiry regression initially exposed only a synchronous
  test assertion mismatch. After correcting it, `pnpm
--config.verify-deps-before-run=false exec vitest run
packages/server/test/services/spine-services.test.ts -t 'retains an inactive
subscription without retrying expiry cleanup until same-ID cancellation
succeeds'` exited 0 with 1 passed/140 skipped. It proves timer clearance,
  retained local record/capacity, no automatic retry/new timer, and same-ID
  `Cancel` cleanup retry/release.

## Canonical Wave 12 Correction Coordinator Verification

- Existing implementer `019f645f-30e8-7170-b0b2-c8c1cc59329b` was dispatched
  explicitly as `gpt-5.6-terra` / medium; the immutable `implementer` role
  confirms the same actual runtime profile. It spawned no children, made no Git
  mutation, and is closed.
- Coordinator inspection accepts the request/reply-only timeout correction,
  two independent shared close bounds with nested directory-removal cleanup,
  the normal inactive-expiry lifecycle regression, and both public doc mirrors.
  The server test's first matcher failure is recorded only as test-authoring
  noise, not as a false product RED claim.
- Fresh native affected suites passed 174/174 (transport 33, server 141).
  Generated build typecheck, docs/API generation with 25 Proto checksums and
  export counts `100/28/205/19/17/6/3`, generated-clean validation, focused
  ESLint, exact Prettier, status/constant/public-boundary/policy scans,
  manifest/lock/package-map cleanliness, tracked-generated absence, and
  `git diff --check` all exited 0.
- Accept this bounded correction for commit. Its immutable implementation
  endpoint must be reconciled into security provenance before generating the
  Canonical Wave 13 package; dedicated security review remains pending.

## Wave 12 Immutable Implementation Endpoint

- Commit `0d8135aa` contains the coordinator-verified D-0088 publisher scope,
  shared-fixture cleanup bound, inactive-expiry regression, public-doc mirrors,
  and durable evidence corrections.
- Both security artifacts now identify `0d8135aa` as substantive implementation
  evidence. This provenance-only follow-up and later review/status commits are
  not implementation evidence. Generate a literal baseline package after this
  reconciliation, then run all four Canonical Wave 13 lanes. Dedicated security
  review remains pending.

## Canonical Review Wave 13 Assignment

- Immutable review endpoint `182f2f96`; package
  `.superpowers/sdd/review-39f2c6f7..182f2f96.diff` contains 59 commits and
  645,058 bytes. Substantive implementation endpoint remains `0d8135aa`.
- Dispatch all four existing roles read-only with explicit immutable profiles:
  style Terra High, documentation Luna Medium, TypeScript/API Terra High, and
  reliability Terra High. Require the full ledger, D-0087 through D-0089,
  current security artifacts, exact package and affected paths, no subagents or
  Git mutation, concrete findings or clean, and superseded-history exclusion.
  Re-review all Wave 12 corrections and retain complete T-0041 scope. Aggregate
  before action; dedicated security review remains pending.

## Canonical Review Wave 13 Result And Architecture Assignment

- Complete accepted findings after coordinator inspection: stale Wave 11/12
  status in both security artifacts; one architecture sentence overcommitting a
  future multi-host transport; publisher regression asserting only `not 123`
  instead of omission/native default; no symmetric second shared-close deadline
  regression; API README omitting the seventh TypeDoc entry point and exact-six
  ZeroMQ gate; and P1 immediate expiry when a configured `inactiveTtlMs` exceeds
  Node's 2,147,483,647 ms timer bound.
- Explicit immutable Desktop profiles: style
  `019f646c-42ea-7fa3-b6cf-faed12248409` Terra High; documentation
  `019f646c-464b-7b61-ad30-fc382b6b2b28` Luna Medium; TypeScript/API
  `019f646c-3ea4-78d3-b599-2a94d6b0be96` Terra High; reliability
  `019f646e-359d-7cd0-8cef-a7b1f5cf541c` Terra High. All four spawned no
  children, made no Git mutation, and are closed.
- Reject the API lane's proposed removal of runtime structural
  `onBackgroundFailure`: D-0089 lines 4042-4045 explicitly preserve runtime
  failure observation through a non-exported internal options extension and
  permit repository tests to pass a locally typed structural value through the
  unchanged public factory. The public type/export/TypeDoc boundary remains
  clean.
- Assign the existing `requirements_splitter`, expected explicit immutable
  `gpt-5.6-sol` / high, read-only, to choose the smallest truthful correction
  for the long-TTL public contract. It must inspect relevant Spine JVM material,
  Node timer semantics, current TSDoc/docs/tests, and decide between validation
  or bounded re-arming without changing unrelated queue-limit behavior. No
  subagents or Git mutation. One Terra Medium implementer receives the complete
  deduplicated batch after the split; all four canonical lanes rerun before the
  dedicated security review.

## Accepted Long-TTL Architecture And Wave 13 Fix Assignment

- Requirements splitter `019f6473-737d-7c33-abe6-998ef9bdd43a` was dispatched
  explicitly as `gpt-5.6-sol` / high; the immutable role confirms the same
  actual runtime profile. It spawned no children, made no Git mutation, and is
  closed.
- Accept a pre-release public-contract narrowing: preserve the 30,000 ms default
  and existing normalization (non-positive/non-finite to 1; positive finite
  values floored), then synchronously reject an effective TTL above
  2,147,483,647 with `TypeError: SpineServices inactiveTtlMs must not exceed
2147483647 milliseconds.` before storage or timer work. Preserve one absolute
  durable expiry, one unref'ed timer, existing clear/failure/cancel/recovery
  semantics, and all queue/subscription-limit behavior. Do not silently cap or
  introduce timer chunking/re-arm policy. Record D-0090.
- Assign one fresh existing `implementer`, expected explicit immutable
  `gpt-5.6-terra` / medium, as sole writer for the complete Wave 13 batch:
  D-0090/source/TSDoc/tests/four public TTL mirrors; exact publisher native-
  default assertion; symmetric second-close regression; API README seventh
  TypeDoc/exact-six gate wording; current security statuses; and architecture
  future-policy exclusion wording. No runtime observer, public export, package,
  dependency, Proto, generated-output, D-0087/D-0088/D-0089, or unrelated
  behavior change. Use test-first evidence and focused verification; all four
  canonical lanes rerun before dedicated security review.

## Canonical Wave 13 Implementer Correction In Progress

- The existing implementer is sole writer; no subagents or Git-state mutation
  are used. The assignment specifies `gpt-5.6-terra` / medium; this surface
  exposes no separate immutable runtime-profile metadata. No child work is
  dispatched or accepted.
- Skill applicability: session inventory and `EXPECTED_SKILLS.md`, the full
  installed entrypoint scan, and readable skill lock were checked. Fully read
  selected skills: `test-driven-development` and
  `verification-before-completion`. Worktree/planning/subagent/Git skills are
  N/A because this assigned worktree and scope already exist and this assignment
  forbids subagents and Git mutation. JVM notes inspected:
  `spine-jvm-docs/spine-server-runtime-and-bounded-context.md`.
- TTL RED command exited 1 with 1 failed/141 skipped because oversized effective
  TTL construction did not throw. Identical GREEN exited 0 with 2 passed/141
  skipped: max TTL has one timer and exact durable absolute expiry; max+1,
  `Number.MAX_SAFE_INTEGER`, and larger finite values throw the exact TypeError
  before timer or subscription-storage creation.
- Publisher coverage now asserts native/default `sendTimeout: -1`. The
  second-close test passed against the established bound; temporary test-fixture
  removal of that bound produced RED (1 failed/33 skipped, outer instead of
  second-close deadline), and restoration produced GREEN (2 passed/32 skipped).
  Directory removal remains in `finally`; production timeout behavior is
  unchanged.
- D-0090, TSDoc, four TTL mirrors, API TypeDoc wording, security statuses, and
  initial-release same-host exclusion wording are updated. D-0089's runtime
  structural observer remains unexported and undocumented. Changed paths:
  `packages/server/src/services/spine-services.ts`,
  `packages/server/test/services/spine-services.test.ts`,
  `packages/transport/test/zeromq/signal-transport.test.ts`,
  `packages/server/README.md`, `docs/api/README.md`, `docs/USER_GUIDE.md`,
  `docs/architecture/README.md`, `build-protocol/DECISION_LOG.md`, both
  security artifacts, and these T-0041 task/work/review logs. Focused final
  validation is pending. Status remains Canonical Wave 13 correction/current
  review in progress; dedicated security review is pending.

- Focused native validation: sandbox failures were only 19 loopback `listen
EPERM` and 18 ZeroMQ IPC `EPERM` cases; the approved native rerun exited 0
  with 2 files/177 tests. `typecheck:build:generated`, `docs:check` (25 copied
  Proto checksums; TypeDoc counts `100/28/205/19/17/6/3`),
  `proto:check-generated`, focused ESLint, and exact 13-path Prettier exited 0.
  Status/constant/public-boundary/future-policy scans preserve the dedicated TTL
  constant and D-0089 private observer with no stale active wording. Manifest,
  lockfile, package-map, and generated tracking are unchanged; `git diff
--check` exited 0.

## Wave 13 Coordinator Evidence Correction

- Coordinator source inspection accepts D-0090, normalization order, timer and
  storage bounds, symmetric cleanup, D-0089 preservation, and the active docs.
  Three evidence/status details remain before commit: assert the oversized TTL
  as the exact `TypeError` object rather than a message-only matcher; replace
  API README's repeated “also checks” wording; and include D-0090 in the current
  security-findings status range.
- Resume the same immutable Terra Medium implementer for only those three edits
  and the focused TTL test, docs check, exact formatting, status scan, and diff
  integrity. No other source, behavior, contract, or Git change is authorized.

## Canonical Wave 13 Correction Coordinator Verification

- Existing implementer `019f647d-2466-7f00-b8f6-14ad056f5489` was dispatched
  explicitly and resumed with immutable `gpt-5.6-terra` / medium; the role
  confirms the same actual runtime profile. It spawned no children, made no Git
  mutation, and is closed.
- Coordinator inspection accepts D-0090, exact normalization and TypeError,
  one-timer/absolute-expiry semantics, TTL tests/docs, exact publisher default,
  symmetric fixture deadlines, API verification text, security statuses, and
  initial-release architecture exclusion. D-0089's internal runtime structural
  observer remains absent from declarations and TypeDoc.
- Fresh native affected suites passed 177/177. Generated build typecheck,
  docs/API generation with 25 Proto checksums and export counts
  `100/28/205/19/17/6/3`, generated-clean validation, focused ESLint, exact
  Prettier, current-status/constant/public-boundary/future-policy scans,
  manifest/lock/package-map integrity, tracked-generated absence, and
  `git diff --check` all exited 0.
- Accept this correction for commit. Update immutable security provenance to
  the substantive commit, then generate Canonical Wave 14. Dedicated security
  review remains pending.

## Wave 13 Immutable Implementation Endpoint

- Commit `fe207c7e` contains the coordinator-verified D-0090 TTL contract,
  service and transport regressions, active documentation/status corrections,
  and durable evidence.
- Both security artifacts now identify `fe207c7e` as substantive implementation
  evidence. This provenance-only follow-up and later review/status commits are
  not implementation evidence. Generate a literal baseline package after this
  reconciliation, then run all four Canonical Wave 14 lanes. Dedicated security
  review remains pending.

## Canonical Review Wave 14 Assignment

- Immutable review endpoint `4b7b3541`; package
  `.superpowers/sdd/review-39f2c6f7..4b7b3541.diff` contains 64 commits and
  683,360 bytes. Substantive implementation endpoint remains `fe207c7e`.
- Dispatch all four existing roles read-only with explicit immutable profiles:
  style Terra High, documentation Luna Medium, TypeScript/API Terra High, and
  reliability Terra High. Require full ledger, D-0087 through D-0090, current
  security artifacts, exact package/affected paths, no subagents or Git
  mutation, findings or clean, and superseded-history exclusion. D-0089's
  locally typed runtime structural observer is accepted and must not be
  relitigated as public leakage absent emitted API evidence. Aggregate before
  action; dedicated security review remains pending.

## Canonical Review Wave 14 Result And Fix Assignment

- Complete result: TypeScript/API and performance/reliability are clean.
  Documentation found only stale Wave 13 security-artifact review status.
  Style found the same status plus two bounded maintainability gaps: public
  `BoundedContextFixtureOptions.inactiveTtlMs` omits D-0090 and fixture-level
  exact-error coverage, and the two symmetric shared-close regressions duplicate
  their full setup/cleanup flow.
- Explicit immutable Desktop profiles: style
  `019f6491-11da-78a3-9b70-002b3886ef8d` Terra High; documentation
  `019f6491-1600-7da2-a5c2-a58ad685e7f9` Luna Medium; TypeScript/API
  `019f6491-1af8-7a92-be40-683315ef695f` Terra High; reliability
  `019f6492-d056-7302-82a0-4c55c26aa939` Terra High. All four spawned no
  children, made no Git mutation, and are closed.
- Assign one fresh existing `implementer`, expected explicit immutable
  `gpt-5.6-terra` / medium, as sole writer. Mirror the exact forwarded D-0090
  contract in testing-fixture TSDoc and add a fixture-level exact TypeError
  regression; extract one short parameterized shared-close assertion helper
  while retaining two explicit named cases; update both security headers,
  TM-005 current status, and the review-round table to Wave 14 pending without
  security acceptance. No production runtime, public symbol shape, dependency,
  package, Proto, generated output, or D-0087-D-0090 behavior change. Run
  focused checks; all four canonical lanes rerun before dedicated security
  review.

## Wave 13 Coordinator Evidence Correction Result

- The oversized-TTL table now matches the exact assigned `TypeError` object;
  API verification prose says `It also checks`; and the current security status
  includes D-0090 in `D-0087 through D-0090`. No runtime implementation,
  contract, or other documentation changed.
- Focused TTL command exited 0 with 2 passed/141 skipped. Fresh `docs:check`
  exited 0 after 25 copied Proto checksum validations and exact TypeDoc counts
  `100/28/205/19/17/6/3`.
- Changed paths for this correction are the server TTL test, API README,
  security-findings artifact, and these T-0041 task/work/review records. Exact
  formatting, current-status scan, and diff integrity remain to be recorded;
  status stays correction/current review in progress with dedicated security
  review pending.

- Exact six-path Prettier passed after formatting the TypeError assertion.
  Current-status scan confirms task in progress, D-0087 through D-0090, and
  Canonical Wave 13 correction/current review plus dedicated security re-review
  pending. `git diff --check` exited 0.

## Canonical Wave 14 Fix In Progress

- Sole existing implementer owns only the accepted TSDoc, fixture regression,
  shared-close helper, security-status, and T-0041-log batch; no subagents or
  Git-state mutation. Runtime forwarding and D-0087 through D-0090 behavior
  remain unchanged.
- Added public-fixture construction coverage for `inactiveTtlMs: 2_147_483_648`
  with the exact assigned `TypeError`. The added test initially passed because
  established service forwarding already enforces D-0090; a temporary inverse
  assertion then produced the expected RED failure, and the exact-error
  assertion was restored before focused validation.
- Both named paused shared-fixture close cases now delegate setup/release and
  pending-operation settlement to one parameterized helper while preserving the
  exact first/second inner deadline labels, each outer deadline label, and the
  `withSharedZeroMqTransports()` directory-removal `finally`.
- Both security artifacts now describe the current corrected Canonical Wave 14
  review as pending, retain the dedicated security re-review as pending, and do
  not claim security acceptance. Focused final checks and Canonical Wave 15
  review remain pending.
- Focused native Vitest rerun passed 2 files / 45 tests. Generated build
  typecheck, generated-clean, and `docs:check` passed; documentation verified
  25 copied Proto checksums and public API counts `100/28/205/19/17/6/3`.
  Focused ESLint and eight-path Prettier passed. Current-status, public-boundary,
  manifest/lock, and generated-output scans found no unauthorized change;
  `git diff --check` passed. Full verification was not run.

## Wave 14 Coordinator Naming And Status Correction

- Coordinator inspection accepts the fixture TSDoc/test, shared-close helper
  behavior, security table updates, and focused evidence. Before commit, shorten
  private `expectPausedSharedFixtureClose` to at most four semantic components
  and replace redundant “current corrected Canonical Wave 14 correction/review”
  wording in both security headers and TM-005 with plain current/pending text.
- Resume the same immutable Terra Medium implementer for only those edits and
  focused transport, formatting, security-status, naming, and diff checks. No
  other change is authorized.

## Canonical Wave 14 Correction Coordinator Verification

- Existing implementer `019f6498-cfff-71d1-96a9-2542e1f36431` was dispatched
  explicitly and resumed with immutable `gpt-5.6-terra` / medium; the role
  confirms the same actual runtime profile. It spawned no children, made no Git
  mutation, and is closed.
- Coordinator inspection accepts testing-fixture D-0090 TSDoc/exact-error
  coverage, the four-component shared-close helper with two explicit cases, and
  current security headers/TM-005/review table without security acceptance.
- Fresh native affected suites passed 45/45. Generated build typecheck,
  docs/API generation with 25 Proto checksums and counts
  `100/28/205/19/17/6/3`, generated-clean validation, focused ESLint, exact
  Prettier, status/naming/public-boundary scans, manifest/lock/package-map
  integrity, tracked-generated absence, and `git diff --check` all exited 0.
- Accept this correction for commit. Reconcile immutable security provenance,
  then assign Wave 15 in both general and security current-status records before
  generating its package. Dedicated security review remains pending.
- Renamed the private helper and its two calls to
  `expectPausedSharedClose`. Both security headers and TM-005 now state plainly
  that Canonical Wave 14 correction/review is current and pending and that the
  dedicated security re-review remains pending, without an acceptance claim.
  Native transport baseline and post-rename runs each passed 34/34; exact
  formatting, naming/status scans, and diff integrity remain pending.
- Final focused evidence: the exact six-path Prettier check passed after
  mechanical threat-model table reflow; the old helper name is absent from
  transport source and the new name occurs at exactly two calls plus one
  declaration. The redundant security phrase is absent, both headers and
  TM-005 retain current/pending Wave 14 plus pending dedicated security wording,
  and `git diff --check` passed. Correction remains in progress pending
  Canonical Wave 15 and dedicated security re-review.

## Wave 14 Immutable Endpoint And Wave 15 Status

- Commit `56934655` is the coordinator-verified Wave 14 testing/docs/status/log
  endpoint. Both security artifacts identify it as substantive implementation
  evidence; this provenance/status follow-up and later review commits are not
  implementation evidence.
- Every current task and security record now identifies Canonical Wave 15 as
  assigned/pending before package generation. Run all four explicit immutable
  roles over the literal baseline package with the full ledger, D-0087-D-0090,
  no subagents or Git mutation, and superseded-history exclusion. Dedicated
  security review remains pending.

## Canonical Review Wave 15 Package

- Immutable endpoint `4e78f73f`; package
  `.superpowers/sdd/review-39f2c6f7..4e78f73f.diff` contains 68 commits and
  708,663 bytes. Substantive implementation remains `56934655`.
- Dispatch style Terra High, documentation Luna Medium, TypeScript/API Terra
  High, and reliability Terra High read-only with the full ledger, D-0087-
  D-0090, current security artifacts, no subagents/Git mutation, concrete
  findings or clean, and superseded-history exclusion. Aggregate before action;
  dedicated security review remains pending.

## Canonical Review Wave 15 Result And Fix Assignment

- Complete result: style and TypeScript/API are clean. Documentation found the
  security headers' historical “Wave 12 coordinator-verified” lead stale while
  Wave 15 is current. Reliability found that `Promise.all()` can reject on one
  bounded shared close and enter directory removal before its sibling bounded
  close settles.
- Explicit immutable profiles: style `019f64ab-13d0-7c63-a36d-1d0a68d054e2`
  Terra High; docs `019f64ab-1053-7142-aa43-29e4f5ec9c17` Luna Medium; API
  `019f64ab-1726-7463-b793-9903f64dee03` Terra High; reliability
  `019f64ad-22c1-7442-9b83-950c6b1b2f7b` Terra High. All used no children or
  Git mutation and are closed.
- Assign one fresh existing `implementer`, expected explicit immutable Terra
  Medium, to await both deadline-wrapped close outcomes, remove the directory
  afterward, and deterministically rethrow the recorded close failure; add
  regression coverage with one timeout while the sibling remains pending.
  Replace both header leads with Wave 14 coordinator-verified while preserving
  Wave 15 and dedicated security pending. No production runtime/public/package/
  Proto/dependency/generated change. Focused checks and all four Canonical Wave
  16 lanes follow.

## Canonical Wave 15 Fix In Progress

- The existing implementer is the sole writer for the accepted test-fixture and
  security-header correction; no subagents or Git-state mutation. Production
  runtime, public API/symbols, packages/dependencies, Proto/generated output,
  D-0087 through D-0090, and other docs remain unchanged.
- RED: the new pending-sibling regression failed against the prior
  `Promise.all()` cleanup with `ENOENT` after directory removal at 75 ms, before
  the sibling bounded close settled. GREEN: cleanup now waits for both
  independently deadline-wrapped close outcomes, attempts removal, then throws
  the first close failure in transport order; a removal-only failure remains
  observable. The two explicit first/second paused-close cases, their inner
  labels, pending-operation settlement, short helper, and finite outer
  deadlines remain intact.
- Both security artifact headers now identify the Wave 14 correction as
  coordinator-verified while retaining provenance `56934655`, Wave 15 pending,
  dedicated security pending, and no security acceptance claim. Focused
  validation passed: ESLint, exact Prettier, `docs:check` (25 copied Proto
  checksums; API counts `100/28/205/19/17/6/3`), generated-clean, status and
  public-boundary/manifest/lock scans, and `git diff --check`. Status remains
  correction in progress pending Canonical Wave 16 and dedicated security
  review.

## Canonical Wave 15 Correction Coordinator Verification

- Existing implementer `019f64b3-a0af-7ac0-97cc-d6df74a2411c` has matching
  explicit and actual immutable `gpt-5.6-terra` / medium evidence, spawned no
  children, made no Git mutation, and is closed.
- Coordinator inspection accepts all-settlement before removal, deterministic
  first close failure precedence, removal-only failure preservation, finite
  underlying-close handling, pending-sibling RED/GREEN coverage, and current
  security header leads without acceptance.
- Fresh native transport passed 35/35. Generated build typecheck, docs/API
  generation with 25 Proto checksums and counts `100/28/205/19/17/6/3`,
  generated-clean, focused ESLint, exact Prettier, status/resource/public-
  boundary scans, manifest/lock/package-map integrity, tracked-generated
  absence, and `git diff --check` all exited 0.
- Accept for commit. Reconcile immutable provenance and advance all general and
  security status records to Wave 16 before its package generation. Dedicated
  security review remains pending.

## Wave 15 Immutable Endpoint And Wave 16 Status

- Commit `68d54fc6` is the coordinator-verified Wave 15 test-fixture/status/log
  endpoint. Both security artifacts identify it as substantive implementation
  evidence; this provenance/status follow-up is not implementation evidence.
- Every current general and security record identifies Canonical Wave 16 as
  assigned/pending before package generation. Run all four immutable canonical
  roles with D-0087-D-0090 and superseded-history exclusion; aggregate before
  action. Dedicated security review remains pending.

## Canonical Review Wave 16 Package And Assignment

- Immutable endpoint `5dff87c1`; package
  `.superpowers/sdd/review-39f2c6f7..5dff87c1.diff` contains 73 commits and
  726,056 bytes. Substantive implementation evidence remains `68d54fc6`.
- Dispatch the existing `style_maintainability_reviewer`, explicit immutable
  `gpt-5.6-terra` / high; `documentation_reviewer`, explicit immutable
  `gpt-5.6-luna` / medium; `typescript_api_docs_reviewer`, explicit immutable
  `gpt-5.6-terra` / high; and `performance_reliability_reviewer`, explicit
  immutable `gpt-5.6-terra` / high.
- All assignments are read-only, prohibit subagents and Git mutation, use the
  full human ledger plus D-0087-D-0090, and exclude superseded history unless a
  current record claims it active. Aggregate the complete wave before action;
  dedicated final security review remains pending.
