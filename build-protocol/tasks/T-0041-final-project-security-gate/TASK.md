# T-0041: Final Project Security Gate

Status: In progress - final security review clean; full task verification pending

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
- Use Buf's generated Protobuf binary serialization, not Node V8 serialization,
  for Proto messages crossing the ZeroMQ adapter.
- Keep 8,388,608 bytes as a hard inbound limit for each ZeroMQ frame; this is a
  maximum, not a fixed allocation for ordinary small signals.
- Consume only the protocol-defined prefix of at most two multipart frames and
  ignore later frames.
- Accept the same-UID local IPC multipart-allocation denial-of-service residual
  for the initial release; do not implement a native receive replacement now.
- After the project is fully complete, research known ZeroMQ/libzmq and
  zeromq.js issues and discussions for this limitation and report known
  workarounds or evidence that the limitation was previously undocumented.

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

## Canonical Review Wave 16 Result And Fix Assignment

- Complete result: TypeScript/API docs and performance/reliability are clean.
  Documentation found one P2 because `examples/todo/USER_GUIDE.md` names the
  configurable inactive TTL and default but omits D-0090 normalization and the
  synchronous maximum-value error. Style found one low-severity defect because
  private `privateDirectoryModeBigInt` has five semantic components.
- Immutable role evidence: style agent
  `019f64c3-f5fc-7a03-be07-984bd75e3605`, Terra High; documentation agent
  `019f64c3-f993-7661-a31d-4c5a466508b5`, Luna Medium; TypeScript/API agent
  `019f64c3-fd33-7792-a2bc-adc45de972d1`, Terra High; reliability agent
  `019f64c6-99b1-76a2-b764-e427c5c850da`, Terra High. Every explicit dispatch
  used its tool-enforced immutable actual role profile, no child or Git
  mutation, and all four agents are closed.
- Assign one fresh existing `implementer`, expected explicit immutable
  `gpt-5.6-terra` / medium, as sole writer. Add the exact D-0090 sentence to the
  example guide, rename only the private bigint mode constant and use, and
  reconcile task/work/review plus both security artifacts to correction/review
  pending. Run focused docs, lint, format, naming/status, and diff checks; no
  runtime behavior, public API, package, Proto, dependency, or generated change
  is authorized. All four Canonical Wave 17 lanes follow.

## 2026-07-15 - Wave 16 Correction Verification

- Fixed the accepted documentation finding with the exact D-0090 inactive-TTL
  normalization and synchronous maximum-value `TypeError` sentence in the to-do
  guide. Renamed only `privateDirectoryModeBigInt` and its one use to
  `privateModeBits`.
- `pnpm docs:check` exited 0: 25 copied Spine Proto checksums verified and API
  counts were `100/28/205/19/17/6/3`. `pnpm exec eslint
packages/transport/src/zeromq/signal-transport.ts` exited 0.
- `pnpm exec prettier --check` over all seven changed paths exited 0; the
  targeted `rg` naming/status/D-0090 scan and `git diff --check` exited 0.
  No runtime behavior, public API, package, dependency, Proto, or generated-
  output change occurred. Wave 17 re-review and the dedicated security
  re-review remain pending.
- Final focused commands/results: `pnpm exec prettier --check` over the seven
  paths named by `git diff --name-only` exited 0; `rg -n
'privateDirectoryModeBigInt|privateModeBits|D-0090|Wave 16 findings are fixed|Wave 17 re-review|dedicated security re-review'`
  over the changed paths exited 0; `git diff --check` exited 0.

## Canonical Wave 16 Correction Coordinator Verification

- Implementer `019f64cd-5f5f-7b73-b801-908620ad0565` was explicitly dispatched
  and ran with the tool-enforced immutable actual `gpt-5.6-terra` / medium
  profile, spawned no child, made no Git mutation, and is closed.
- Coordinator inspection accepts the exact D-0090 example mirror, private
  two-occurrence `privateModeBits` rename, and synchronized Wave 17/dedicated-
  security pending status without runtime or public-contract change.
- Fresh `docs:check` passed with 25 Proto checksums and API counts
  `100/28/205/19/17/6/3`. Focused ESLint, exact seven-path Prettier,
  naming/status/D-0090 scans, generated/package-boundary checks, and `git diff
--check` all exited 0.
- Accept this seven-path correction for commit. After the immutable endpoint is
  known, reconcile provenance and assign Canonical Wave 17 before package
  generation. Dedicated final security review remains pending.

## Wave 16 Post-Commit Format Correction

- The combined pre-commit shell sequence reported a Prettier warning in this
  task log after the coordinator section was appended, but its later
  `git diff --check` command exited 0 and allowed commit `b70ecb08` to proceed.
- Prettier corrected the single Markdown wrap immediately. Treat `b70ecb08` as
  the substantive correction commit, not the final verified package endpoint;
  fresh exact formatting and diff checks follow in the format-only commit.

## Wave 16 Immutable Endpoint And Wave 17 Status

- Commit `b70ecb08` is the substantive coordinator-verified Wave 16 docs/name/
  status correction. Commit `ac74c574` is its verified format/log endpoint;
  later provenance/status commits are not implementation evidence.
- Every current general and security record identifies Canonical Wave 17 as
  assigned/pending before package generation. Run all four immutable canonical
  roles with the full ledger, D-0087-D-0090, and superseded-history exclusion;
  aggregate before action. Dedicated final security review remains pending.

## Canonical Review Wave 17 Package And Assignment

- Immutable endpoint `05ed3109`; package
  `.superpowers/sdd/review-39f2c6f7..05ed3109.diff` contains 80 commits and
  746,152 bytes. Substantive implementation evidence remains `b70ecb08`.
- Dispatch existing style/maintainability Terra High, documentation Luna
  Medium, TypeScript/API docs Terra High, and performance/reliability Terra High
  roles with explicit immutable profiles. All are read-only, childless, and
  Git-read-only with the full ledger, D-0087-D-0090, and superseded-history
  exclusion. Aggregate the complete wave before action; dedicated final
  security review remains pending.

## Canonical Review Wave 17 Result And Fix Assignment

- Complete result: TypeScript/API docs and performance/reliability are clean.
  Documentation found a P2 because three active retry passages imply a bare
  subscription ID is an accepted `Cancel` request, while the public service
  accepts the returned `Subscription` message. Style found a P2 because active
  security evidence still cites old tenant-restoration and redaction-test line
  ranges.
- Immutable role evidence: style agent
  `019f64d9-e683-7370-997b-a8a80886361b`, Terra High; docs agent
  `019f64d9-e9ab-7d11-aacb-6dceb485ebb9`, Luna Medium; API agent
  `019f64d9-e254-7450-83f9-dc73260feb7e`, Terra High; reliability agent
  `019f64db-9ae9-7813-8d81-c5e73381b966`, Terra High. Every explicit dispatch
  used its tool-enforced immutable actual role profile, no child or Git
  mutation, and all four are closed.
- Assign one fresh existing `implementer`, expected explicit immutable
  `gpt-5.6-terra` / medium, as sole writer. In the three public docs, consistently
  require the same returned `Subscription` message containing its ID for retry.
  Update only the three security evidence anchors to `spine-services.ts:793-815`
  and `signal-transport.test.ts:817-848`, then synchronize correction status in
  task/work/review and both security artifacts. Run focused docs, exact format,
  anchor/request-shape/status, and diff checks. No runtime/public API/package/
  Proto/dependency/generated change is authorized; all Canonical Wave 18 lanes
  follow before dedicated security review.

## 2026-07-15 - Wave 17 Documentation And Evidence Correction

- The complete accepted Wave 17 batch is fixed and in correction verification:
  all three active public docs now require retrying `Cancel` with the same
  returned `Subscription` message containing its ID, while retaining the
  internal initial-`Subscribe` cleanup distinction. The three security anchors
  now use `spine-services.ts:793-815` and `signal-transport.test.ts:817-848`.
- No runtime, test, public API, package, dependency, Proto, generated-output,
  or D-0087 through D-0090 contract change is made. Canonical Wave 18 re-review
  and dedicated security re-review are pending; no canonical or security
  acceptance is claimed.
- Evidence: `pnpm --config.verify-deps-before-run=false docs:check` exited 0
  (25 copied Proto checksums; API counts `100/28/205/19/17/6/3`); exact
  eight-path Prettier, active wording/anchor/status `rg`, and `git diff --check`
  exited 0. No tests or full verification ran.

## Wave 17 Coordinator Status Correction

- Direct inspection accepts the public wording and exact anchors but finds the
  task, work, and review top statuses still say findings accepted/correction
  assigned while their new entries and both security headers say correction
  verification is current.
- Resume the same explicitly dispatched, immutable Terra Medium implementer to
  update only those three top statuses to Wave 17 fixed/correction verification
  current and Wave 18 pending. Re-run exact formatting, active-status scan, and
  diff integrity; no other change is authorized.

## Canonical Wave 17 Correction Coordinator Verification

- Implementer `019f64e1-5753-7bc3-835d-5a62005c7b11` used its original explicit,
  tool-enforced immutable actual `gpt-5.6-terra` / medium profile for the exact
  eight-path batch and resumed three-status correction, spawned no child, made
  no Git mutation, and is closed.
- Coordinator inspection accepts all six retry sentences, exact `793-815` and
  `817-848` active anchors, initial-`Subscribe` cleanup distinction, and five
  synchronized current-status records without runtime/public-contract change.
- Fresh `docs:check` passed with 25 Proto checksums and API counts
  `100/28/205/19/17/6/3`. Exact eight-path Prettier, request-shape/anchor/status
  scans, generated/package-boundary checks, and `git diff --check` all exited 0.
- Accept this documentation/evidence correction for commit. Reconcile its
  immutable endpoint and assign Canonical Wave 18 before package generation;
  dedicated final security review remains pending.

## Wave 17 Immutable Endpoint And Wave 18 Status

- Commit `fa5e4b65` is the substantive coordinator-verified Wave 17 public-doc/
  security-evidence/status correction. Later provenance/status commits are not
  implementation evidence.
- Every current general and security record identifies Canonical Wave 18 as
  assigned/pending before package generation. Run all four immutable canonical
  roles with the full ledger, D-0087-D-0090, and superseded-history exclusion;
  aggregate before action. Dedicated final security review remains pending.

## Canonical Review Wave 18 Package And Assignment

- Immutable endpoint `44d5a140`; package
  `.superpowers/sdd/review-39f2c6f7..44d5a140.diff` contains 86 commits and
  765,320 bytes. Substantive implementation evidence remains `fa5e4b65`.
- Dispatch existing style/maintainability Terra High, documentation Luna
  Medium, TypeScript/API Terra High, and performance/reliability Terra High
  roles with explicit immutable profiles, read-only, childless, Git-read-only,
  the full ledger, D-0087-D-0090, and superseded-history exclusion. Aggregate
  before action; dedicated final security review remains pending.

## Canonical Review Wave 18 Result And Fix Assignment

- Complete result: TypeScript/API is clean. Documentation/reliability both found
  a P2 that active TM-005/SF-008 omit D-0090's normalization, maximum
  2,147,483,647-ms TTL, and source/test evidence. Style found P2s for a stale IPC
  preparation range and a provenance sentence conflating Canonical Wave 18 with
  the separate dedicated security re-review. Reliability also found a P2:
  activation attachment failure is replaced when durable cleanup also fails.
- Immutable role evidence: style agent
  `019f64ef-983f-7140-a642-db07d66cf461`, Terra High; docs agent
  `019f64ef-913e-7480-9060-fc966a67fd9c`, Luna Medium; API agent
  `019f64ef-94ba-7a43-bf27-b06708c22450`, Terra High; reliability agent
  `019f64f1-b972-7ee0-b06a-3955be772701`, Terra High. Every explicit dispatch
  used its tool-enforced immutable actual role profile, no child or Git
  mutation, and all four are closed.
- Assign one fresh existing `implementer`, expected explicit immutable
  `gpt-5.6-terra` / medium, as sole writer. TDD the simultaneous activation-
  attachment/cleanup failure: preserve an `AggregateError` ordered attachment
  first and cleanup second, retained capacity, and successful same-ID cleanup/
  replacement retry. Correct TM-005/SF-008 with exact D-0090 behavior and
  source/test anchors, correct IPC evidence to the actual preparation/recheck
  range, untangle canonical/security status, and synchronize all current logs.
  Run focused native service tests, generated typecheck, docs, lint/format,
  status/anchor/boundary/diff checks. All Canonical Wave 19 lanes follow before
  dedicated final security review.

## 2026-07-15 - Wave 18 Reliability And Evidence Correction

- RED: the new persisted-subscription regression ran with
  `pnpm exec vitest run packages/server/test/services/spine-services.test.ts -t
'preserves attachment failure when durable activation cleanup also fails'` and
  failed because the iterator rejected with `ConnectError: [internal]
Subscription cancellation failed.` instead of `AggregateError`.
- GREEN: `#activate()` now retains both failures as `AggregateError` errors in
  attachment-then-cleanup order. The regression proves retained durable cancel
  fence/capacity while cleanup fails, then same returned `Subscription`
  cancellation and replacement subscription success after the fault clears.
- Wave 18 findings are fixed and correction verification is current; Canonical
  Wave 19 and dedicated security re-review remain pending. No acceptance is
  claimed.
- Final focused verification passed: related activation/cancellation/capacity
  tests, generated build typecheck, docs, focused ESLint, exact seven-path
  Prettier, D-0090/IPC/status/public-boundary/generated scans, and diff
  integrity. Full `pnpm verify` was not run by assignment.

## Wave 18 Coordinator Anchor Correction

- Fresh coordinator line inspection found that the activation fix shifted the
  active D-0090 source policy to `spine-services.ts:1468-1501`; both security
  artifacts still cite the superseded `1461-1493` range. The test evidence at
  `spine-services.test.ts:2429-2495` remains exact.
- Resume the same explicitly dispatched immutable Terra Medium implementer to
  correct only the two active security-artifact source anchors and rerun exact
  formatting, anchor, changed-path, and diff-integrity checks. No runtime,
  test, public API, package/dependency, Proto, generated-output, or D-0090
  contract change is authorized.

## Wave 18 Correction Coordinator Verification

- Implementer `019f64f8-06cf-7b03-adc9-5792d886d8ad` used the original explicit,
  tool-enforced immutable actual `gpt-5.6-terra` / medium profile for both the
  correction batch and resumed two-anchor edit, spawned no child, made no Git
  mutation, and is closed.
- Fresh coordinator regression verification passed `1/1`; the related
  activation/cancellation/capacity selection passed `5/5` with `139` skipped.
  Generated build typecheck passed, and `docs:check` validated 25 copied Proto
  checksums plus API counts `100/28/205/19/17/6/3`.
- Focused ESLint, generated-clean policy, exact seven-path Prettier, positive
  `1468-1501` and negative stale-anchor scans, synchronized status, public/
  package boundary inspection, exact changed-path proof, and `git diff --check`
  all passed. Accept the Wave 18 correction for commit; Canonical Wave 19 and
  dedicated security re-review remain pending.

## Wave 18 Immutable Endpoint And Wave 19 Status

- Commit `cbad2d78` is the substantive coordinator-verified Wave 18 reliability,
  regression, security-evidence, and status correction. Later provenance and
  review records are not implementation evidence.
- Canonical Wave 19 is assigned before package generation. Run all four
  immutable canonical roles with the full ledger, D-0087-D-0090, current
  security artifacts, changed execution paths, and superseded-history
  exclusion; aggregate the complete wave before action. Dedicated final
  security re-review remains pending.

## Canonical Review Wave 19 Package And Assignment

- Immutable endpoint `6791185d`; package
  `.superpowers/sdd/review-39f2c6f7..6791185d.diff` contains 92 commits and
  797,200 bytes. Substantive implementation evidence remains `cbad2d78`.
- Dispatch existing style/maintainability Terra High, documentation Luna
  Medium, TypeScript/API Terra High, and performance/reliability Terra High
  roles with explicit immutable profiles, read-only, childless, Git-read-only,
  the full ledger, D-0087-D-0090, affected execution paths, current security
  artifacts, and superseded-history exclusion. Aggregate before action;
  dedicated final security review remains pending.

## Canonical Review Wave 19 Result And Fix Assignment

- Complete result: style, documentation, and TypeScript/API are clean.
  Performance/reliability found one P2: subscriber, responder, and publisher
  setup can resume after asynchronous IPC preparation/recheck and initiate
  native `connect`/`bind` after `close()` has set the transport closed. The
  request path already applies the required open-state gates.
- Immutable role evidence: style agent
  `019f6507-f1f6-7a31-891a-fe7fdc49606f`, Terra High; docs agent
  `019f6507-f939-7540-a3ad-a65a29b7953d`, Luna Medium; API agent
  `019f6507-f637-7eb1-82f1-ca077c76e0c1`, Terra High; reliability agent
  `019f650a-1ab9-7092-869a-f414b04fcde9`, Terra High. Every explicit dispatch
  used its tool-enforced immutable actual profile, no child or Git mutation,
  and all four are closed.
- Resume the existing implementer context, expected original explicit immutable
  `gpt-5.6-terra` / medium, as sole writer. TDD paused-preparation shutdown for
  subscriber connect, responder bind, and publisher bind; add the open-state
  gate immediately after each final asynchronous recheck and before native
  work. Preserve cleanup, close waiting, request behavior, public API, IPC path
  policy, and error wording. Run focused native transport tests, generated
  typecheck, docs, lint/format/status/boundary/diff checks. All four Canonical
  Wave 20 lanes follow before dedicated final security review.

## 2026-07-15 - Wave 19 IPC Shutdown-Gate Correction

- RED: six deterministic preparation/recheck races failed because close still
  allowed subscriber `connect`, responder `bindReply`, and publisher
  `bindPublisher`; each operation surfaced its injected native-work error rather
  than `ZeroMQ signal transport is closed.`
- GREEN: subscriber, responder, and publisher setup now require an open
  transport immediately after IPC preparation and again after identity recheck,
  before native work. Targeted regressions passed `6/6`; the unrestricted native
  transport file passed `41/41` after the sandbox run was blocked by IPC
  `EPERM`.
- Generated build typecheck, `docs:check`, and focused ESLint passed. Wave 19
  finding fixed and correction verification current; Canonical Wave 20 and
  dedicated security re-review remain pending. No acceptance is claimed.
- Final focused verification passed exact changed-path formatting,
  status/security-anchor/public-boundary/generated-clean scans, and diff
  integrity. Full `pnpm verify` was not run by assignment.

## Wave 19 Correction Coordinator Verification

- Implementer `019f64f8-06cf-7b03-adc9-5792d886d8ad` used its original explicit,
  tool-enforced immutable actual `gpt-5.6-terra` / medium profile, spawned no
  child, made no Git mutation, and is closed.
- Fresh coordinator targeted verification passed all `6/6` preparation/recheck
  shutdown races. The required unrestricted full ZeroMQ transport file passed
  `41/41`; each new path prevents native work and preserves close settlement.
- Generated build typecheck, `docs:check` (25 Proto checksums; API counts
  `100/28/205/19/17/6/3`), focused ESLint, generated-clean policy, exact
  seven-path Prettier, current-status/open-gate/public-package-boundary scans,
  exact changed-path proof, and `git diff --check` passed. Accept the Wave 19
  correction for commit; Canonical Wave 20 and dedicated security re-review
  remain pending.

## Wave 19 Immutable Endpoint And Wave 20 Status

- Commit `0b7fa354` is the substantive coordinator-verified Wave 19 IPC
  shutdown-gate and regression correction. Later provenance/review/status
  commits are not implementation evidence.
- Canonical Wave 20 is assigned before package generation. Run all four
  immutable canonical roles over the full ledger, D-0087-D-0090, affected IPC
  lifecycle paths, current security artifacts, and superseded-history
  exclusion; aggregate before action. Dedicated final security re-review
  remains pending.

## Canonical Review Wave 20 Package And Assignment

- Immutable endpoint `2da01c90`; package
  `.superpowers/sdd/review-39f2c6f7..2da01c90.diff` contains 98 commits and
  821,495 bytes. Substantive implementation evidence remains `0b7fa354`.
- Lightweight pre-review lint confirmed synchronized status/provenance, no
  duplicate policy constant or public export in the correction, no active
  future-policy overclaim, and clean package diff integrity.
- Dispatch existing style/maintainability Terra High, documentation Luna
  Medium, TypeScript/API Terra High, and performance/reliability Terra High
  roles explicitly, read-only, childless, Git-read-only, with the full ledger,
  D-0087-D-0090, affected IPC lifecycle paths, current security artifacts, and
  superseded-history exclusion. Aggregate before action; dedicated final
  security review remains pending.

## Canonical Review Wave 20 Result And Fix Assignment

- Complete result: TypeScript/API is clean. Documentation/style duplicate one
  P2 because active SF-010/TM-007/TM-011 shutdown-control claims lack exact
  current source/test anchors. Style adds a P2 because
  `expectCloseBlocksNativeOperation` exceeds four semantic components and a P3
  because publisher coverage constructs an unused subscription.
- Reliability adds two P2s: request has no paused-recheck shutdown regression;
  and request plus pre-bound publisher cleanup can replace an initiating error
  when socket close also throws, unlike subscriber/responder ordered
  `AggregateError` composition.
- Immutable role evidence: style agent
  `019f651b-abc5-7792-a719-5d724ed0ff48`, Terra High; docs agent
  `019f651b-af0f-7352-9495-182a7340674e`, Luna Medium; API agent
  `019f651b-a733-7191-a42e-180ca449e3bd`, Terra High; reliability agent
  `019f651d-5895-7b03-b8f7-0aa0b612743a`, Terra High. Every explicit dispatch
  used its tool-enforced immutable actual profile, no child or Git mutation,
  and all four are closed.
- Resume the existing implementer context, expected original explicit immutable
  `gpt-5.6-terra` / medium, as sole writer. TDD request recheck shutdown and
  request/publisher ordered primary-plus-cleanup failure composition; extend the
  concise operation/boundary matrix, shorten the helper name, construct
  subscriptions only for operations that use them, and add exact stable active
  security anchors after code settles. Preserve public API, path policy,
  cleanup/close bounds, package/Proto/generated boundaries, and error order.
  Focused native transport verification and all Canonical Wave 21 lanes follow
  before dedicated security review.

## Canonical Wave 20 Correction

- The close-versus-asynchronous-boundary matrix now covers subscriber,
  responder, publisher, and request setup at preparation and recheck. Request
  preparation/recheck rejects with the existing closed error and reaches
  neither native connect nor send. This request recheck case characterizes the
  production gate already present; it was not manufactured as a production
  RED. The helper is `expectCloseBlocksNative`, and only subscriber/responder
  cases construct subscriptions.
- Behavior-first cleanup composition was RED before production correction: the
  focused command reported 2 failed and 8 passed because request and pre-bound
  publisher setup returned only their initiating errors when injected socket
  close also failed. Request and unbound-publisher cleanup now use the existing
  socket-access close seam and preserve ordered
  `AggregateError([primaryError, cleanupError])` results with operation-specific
  messages. Bound-publisher cleanup remains unchanged.
- Focused GREEN reported 10 passed and 34 skipped. Final unrestricted/native
  transport verification reported 44/44 passed; generated build typecheck and
  focused ESLint also exited 0. Exact final documentation, formatting, status,
  boundary, generated-clean, and diff evidence is appended to the work and
  review logs. No acceptance is claimed; Canonical Wave 21 and the dedicated
  security re-review remain pending.

## Wave 20 Correction Coordinator Verification

- Implementer `019f64f8-06cf-7b03-adc9-5792d886d8ad` retained its original
  explicit, tool-enforced immutable actual `gpt-5.6-terra` / medium profile,
  spawned no child, made no Git mutation, and is closed.
- Fresh coordinator focused verification passed `10/10` with `34` skipped; the
  required unrestricted native ZeroMQ file passed `44/44`. Generated build
  typecheck, `docs:check` (25 Proto checksums; API counts
  `100/28/205/19/17/6/3`), focused ESLint, and generated-clean policy passed.
- Exact active source/test/native-evidence anchors, synchronized status, exact
  seven-path Prettier, public-package boundaries, changed paths, and `git diff
--check` passed. Accept the Wave 20 correction for commit; Canonical Wave 21
  and dedicated security re-review remain pending.

## Wave 20 Immutable Endpoint And Wave 21 Status

- Commit `b9f1ea58` is the substantive coordinator-verified Wave 20 IPC
  coverage, cleanup-composition, test-maintainability, evidence, and status
  correction. Later provenance/review/status commits are not implementation
  evidence.
- Canonical Wave 21 is assigned before package generation. Run all four
  immutable canonical roles over the full ledger, D-0087-D-0090, affected IPC
  lifecycle/error paths, current security artifacts, and superseded-history
  exclusion; aggregate before action. Dedicated final security re-review
  remains pending.

## Canonical Review Wave 21 Package And Assignment

- Immutable endpoint `05d218db`; package
  `.superpowers/sdd/review-39f2c6f7..05d218db.diff` contains 104 commits and
  850,893 bytes. Substantive implementation evidence remains `b9f1ea58`.
- Lightweight pre-review lint confirmed synchronized status/provenance, no
  duplicate policy source or public export in the correction, no active
  future-policy overclaim, and clean package diff integrity.
- Dispatch existing style/maintainability Terra High, documentation Luna
  Medium, TypeScript/API Terra High, and performance/reliability Terra High
  roles explicitly, read-only, childless, Git-read-only, with the full ledger,
  D-0087-D-0090, affected IPC lifecycle/error paths, current security artifacts,
  and superseded-history exclusion. Aggregate before action; dedicated final
  security review remains pending.

## Canonical Review Wave 21 Result And Architecture Assignment

- Complete result: style and TypeScript/API are clean. Documentation found one
  P2: active SF-007/SF-008/SF-009 and TM-004 implemented/tested claims lack
  exact current source, test, and native-evidence anchors.
- Reliability found P1 because an already-bound publisher can pass the initial
  open check, race close across `await #publisherFor()`, and send without a
  second gate or tracked in-flight operation; close currently drains binds,
  responders, subscribers, and requests only. It also found P2 because ordinary
  successful-request cleanup and cleanup-only failure lack behavior coverage.
- Immutable role evidence: style agent
  `019f6534-1166-75b0-89a5-4076ed9abbd6`, Terra High; docs agent
  `019f6534-0cde-7da2-b401-ffd9f67fc2a4`, Luna Medium; API agent
  `019f6534-1592-7830-8442-2918b0b4cf3e`, Terra High; reliability agent
  `019f6536-40b6-7f31-8c54-173bae2354cb`, Terra High. Every role used its
  explicit tool-enforced immutable actual profile, no child or Git mutation,
  and all four are closed.
- The P1's finite publisher-timeout suggestion conflicts with accepted D-0088,
  which bounds request/reply only, and with explicit native-default publisher
  coverage. Assign existing `requirements_splitter`, expected explicit
  immutable `gpt-5.6-sol` / high, read-only and childless, to select the
  smallest concurrency/lifecycle correction that prevents post-close native
  work and settles in-flight publish/close safely without silently changing
  D-0088 or public options. It must decide whether D-0088 must change and give
  exact behavior-focused acceptance tests. Implementation waits for this
  architecture result; dedicated security review remains pending.

## Canonical Wave 21 Architecture Dispatch

- Existing requirements splitter `019f653b-6759-7280-b084-f35ad44270d2` was
  dispatched explicitly with immutable `gpt-5.6-sol` / high, read-only,
  childless, and Git-read-only. It must resolve publish/close ordering against
  installed ZeroMQ semantics and D-0088, then return one smallest implementation
  contract with exact tests and explicit decision disposition.

## Canonical Wave 21 Architecture Result And Fix Assignment

- Requirements splitter `019f653b-6759-7280-b084-f35ad44270d2` completed under
  its explicit, tool-enforced immutable actual `gpt-5.6-sol` / high role,
  spawned no child, made no Git mutation, and is closed.
- Accept “gate, track, close, then drain.” Add package-private publisher send
  access, track the complete publish promise, gate again immediately after
  publisher lookup, close publisher sockets before awaiting tracked publishes,
  then drain publishes. Publish/native-send errors remain with `publish()`;
  cleanup/unlink errors remain with `close()`; close retry ordering remains.
- D-0088 is preserved without amendment. Publisher `sendTimeout` remains native
  `-1`; no public option, timeout/cancellation policy, or delivery guarantee is
  added. Installed ZeroMQ 6.5.0 closes pending poller operations before native
  socket disposal, and publisher linger remains zero.
- Resume the existing implementer context, expected original explicit immutable
  `gpt-5.6-terra` / medium, as sole writer. TDD no-send-after-close, in-flight
  send close-before-drain ordering, separate publish/close error ownership and
  retry, successful request cleanup, and cleanup-only failure. Correct the
  SF-007/SF-008/SF-009/TM-004 exact evidence anchors plus final SF-010/TM-011
  anchors/status after code settles. Preserve public/package/Proto/generated
  boundaries and all accepted decisions. Run focused native transport and
  Canonical Wave 22 before dedicated security review.

## Canonical Wave 21 Correction

- Implemented the accepted “gate, track, close, then drain” contract. Public
  publish gates and tracks its complete private operation; the private path
  gates immediately after publisher lookup before package-private native send.
  Close preserves setup/request and active-handle ordering, closes publisher
  cleanup before draining tracked publishes, and keeps publish/send failures
  with callers while close retains only cleanup failures and retry behavior.
- Valid unrestricted RED was 3 failed/3 passed/43 skipped: all three publisher
  lifecycle cases exposed the missing gate/drain, while the native-default
  publisher timeout and two request-cleanup characterizations passed. The
  identical GREEN was 6 passed/43 skipped. Unrestricted full transport
  verification passed 49/49 and generated build typecheck exited 0.
- D-0088 remains unchanged, Publisher `sendTimeout` remains native `-1`, and no
  public option, timeout/cancellation policy, or delivery guarantee was added.
  Canonical Wave 21 findings are fixed and correction verification is current;
  Canonical Wave 22 and dedicated security re-review remain pending. No
  acceptance is claimed.
- Final narrow verification passed generated build typecheck, `docs:check`,
  focused ESLint, generated-clean, exact seven-path Prettier, synchronized
  status/current and stale-anchor scans, public-package boundaries, exact
  changed paths, and diff integrity. Full `pnpm verify` remained reserved.

## Canonical Wave 21 Coordinator Verification

- The implementer returned under its original explicit, tool-enforced immutable
  actual `gpt-5.6-terra` / medium profile, made no Git-state mutation, spawned
  no child, and is closed.
- Fresh unrestricted coordinator verification passed the six focused lifecycle
  and request-cleanup cases with 43 skipped, then passed the complete native
  ZeroMQ transport file 49/49.
- Generated build typecheck, `docs:check` with 25 copied Proto checksums and API
  counts `100/28/205/19/17/6/3`, focused ESLint, generated-clean policy, exact
  seven-path Prettier, synchronized status/anchor and public-boundary scans,
  exact changed paths, and `git diff --check` all passed.
- Direct source inspection accepts the post-lookup gate, complete publish
  tracking, publisher cleanup before publish drain, caller-owned publish errors,
  close-owned cleanup errors, unchanged retry order, and unchanged D-0088/native
  publisher timeout. Commit the correction and assign Canonical Wave 22 before
  generating its immutable review package.

## Wave 21 Immutable Endpoint And Canonical Wave 22 Assignment

- Commit `c7f8a901` freezes the substantive Wave 21 correction and fresh
  coordinator evidence. Later assignment/provenance commits are not
  implementation evidence.
- Canonical Wave 22 assigns the existing style/maintainability Terra High,
  documentation Luna Medium, TypeScript/API Terra High, and performance/
  reliability Terra High roles over one fresh literal baseline-to-endpoint
  package. Each role is read-only, childless, and Git-read-only with the full
  human ledger, D-0087 through D-0090, current security artifacts, corrected
  transport lifecycle/error paths, and superseded-history exclusion.
- Aggregate the complete four-lane wave before action. Dedicated final security
  re-review remains pending until canonical closure.

## Canonical Wave 22 Pre-Review Lint

- Current task/work/review and both security-artifact statuses agree: Wave 21
  correction is current; Wave 22 and dedicated security re-review are pending.
- Targeted full-range scans found no duplicated new transport policy constant,
  no new transport public export, no generated output, and no active promise of
  monitoring, scheduling, backoff, catch-up, multi-host topology, or automatic
  reclamation. Matching future-policy text is an explicit exclusion/residual.
- The sole public-root file in the full range is the intentional existing
  `BoundedContextFixtureOptions.inactiveTtlMs` TSDoc clarification already owned
  by SF-008/D-0090; no internal callback, lifecycle, retry, or IPC primitive is
  exported. Range diff integrity and worktree status are clean.

## Canonical Wave 22 Package

- Immutable package `.superpowers/sdd/review-39f2c6f7..1ba74c5c.diff` contains
  113 commits and 886,290 bytes from literal baseline `39f2c6f7` to literal
  endpoint `1ba74c5c`. Substantive Wave 21 implementation remains `c7f8a901`.
- Dispatch the four assigned canonical roles against this exact package and
  aggregate all results before action.

## Canonical Wave 22 Dispatch

- Style/maintainability agent `019f6555-6e2b-7af0-ba7f-25f04763a446` was
  dispatched explicitly as the existing immutable `gpt-5.6-terra` / high role.
- Documentation agent `019f6555-96b6-71b3-838a-abc7e6c7e279` was dispatched
  explicitly as the existing immutable `gpt-5.6-luna` / medium role.
- TypeScript/API agent `019f6555-b978-73c2-8920-813d44d5fa24` was dispatched
  explicitly as the existing immutable `gpt-5.6-terra` / high role.
- All are read-only, childless, and Git-read-only with distinct bounded
  concerns. Reliability waits only for execution-surface capacity; aggregate
  the complete four-lane wave before action.

## Canonical Wave 22 Dispatch Continuation

- Documentation agent `019f6555-96b6-71b3-838a-abc7e6c7e279` completed clean
  under its explicit, tool-enforced immutable actual `gpt-5.6-luna` / medium
  role, made no Git mutation, spawned no child, and is closed.
- Reliability agent `019f6557-7839-7801-bd4f-4bdf0a09ea79` was dispatched
  explicitly as the existing immutable `gpt-5.6-terra` / high role, read-only,
  childless, and Git-read-only. Retain the clean docs result and aggregate all
  four lanes before action.

## Canonical Wave 22 Result And Fix Assignment

- Complete wave: documentation, TypeScript/API, and performance/reliability are
  clean. Style/maintainability reports one accepted P2: test helper
  `expectCloseBlocksNative()` spans 112 lines and combines the shared pause/
  close/drain harness with four operation-specific setups and assertions.
- Explicit tool-enforced immutable actual roles match dispatch: style
  `019f6555-6e2b-7af0-ba7f-25f04763a446` Terra High; docs
  `019f6555-96b6-71b3-838a-abc7e6c7e279` Luna Medium; API
  `019f6555-b978-73c2-8920-813d44d5fa24` Terra High; reliability
  `019f6557-7839-7801-bd4f-4bdf0a09ea79` Terra High. All made no Git mutation,
  spawned no child, and are closed.
- Return the complete one-finding batch to the existing implementer under its
  original immutable Terra Medium profile. Refactor only the test helper into a
  short shared lifecycle harness plus operation-specific setup/assertion; keep
  production behavior, coverage matrix, assertions, security anchors, and all
  public/package/Proto/generated boundaries unchanged. Rerun focused and full
  native transport checks plus narrow lint/format/diff. Only style re-review is
  required unless the correction changes another concern.

## Canonical Wave 22 Correction

- The existing implementer resumed under its original explicit immutable
  `gpt-5.6-terra` / medium profile as sole writer, with no child or Git-state
  mutation. The mandatory skill check selected `implement`,
  `javascript-testing-patterns`, and `verification-before-completion`; TDD was
  not applicable because this is an equivalent test-fixture refactor with no
  new behavior or production seam. The skill defaults for child review and
  commit are superseded by the explicit assignment.
- Refactored only `signal-transport.test.ts`: the eight-case parameterized
  matrix is unchanged, operation-specific topic/open/native-seam behavior is
  declarative, and short boundary and close/drain helpers retain the closed
  rejection, close-wait ordering, and native-not-called assertions. No
  production, public/package, dependency, Proto, or generated path changed.
- The unrestricted focused matrix passed 8/8 with 41 skipped, and the fresh
  unrestricted complete native transport file passed 49/49. Focused ESLint
  initially exposed four shorthand-void style errors; after block-body-only
  correction it exited 0. Canonical Wave 22's finding is fixed and correction
  verification is current; focused style re-review and dedicated security
  re-review remain pending. No acceptance is claimed.

## Canonical Wave 22 Correction Coordinator Verification

- The existing implementer returned under its original explicit,
  tool-enforced immutable actual Terra Medium profile, made no Git mutation,
  spawned no child, and is closed.
- Fresh unrestricted coordinator verification passed the exact eight-case
  close-boundary matrix with 41 skipped and the complete native ZeroMQ
  transport file 49/49. Focused test ESLint, `docs:check`, generated-clean,
  exact six-path Prettier, status/anchor scans, production/public-boundary scan,
  exact changed paths, and diff integrity passed.
- Direct inspection accepts the declarative four-operation table, 25-line
  dispatcher, separate boundary fixture, separate lifecycle harness, and four
  small native guards. All prior cases/assertions remain, and no production
  source changed. Commit and run only the focused style re-review unless later
  edits expand scope.

## Wave 22 Correction Endpoint And Focused Style Assignment

- Commit `fdd9da0a` freezes the test-only Wave 22 correction and coordinator
  evidence. Documentation, TypeScript/API, and performance/reliability remain
  clean because no production, public, docs-behavior, or boundary scope changed.
- Assign the existing style/maintainability role, expected explicit immutable
  `gpt-5.6-terra` / high, read-only and childless, over a fresh literal package.
  Review only the accepted helper-shape finding, equivalent case/assertion
  preservation, naming/complexity, current anchors/status, and correction
  chronology. Dedicated security re-review remains pending.

## Wave 22 Focused Style Package

- Fresh package `.superpowers/sdd/review-39f2c6f7..a5039140.diff` contains 119
  commits and 906,249 bytes from literal baseline `39f2c6f7` to literal endpoint
  `a5039140`. Test-only correction evidence is `fdd9da0a`.
- The focused pre-review status, production/public-boundary, generated-output,
  and range-diff checks are clean. Dispatch only the assigned style lane.

## Wave 22 Focused Style Dispatch

- Style agent `019f6567-3e79-7733-acf9-f5622771c8d2` was dispatched explicitly
  under the existing immutable `gpt-5.6-terra` / high role, read-only,
  childless, and Git-read-only, against the exact focused package.

## Canonical Review Closure

- Focused style agent `019f6567-3e79-7733-acf9-f5622771c8d2` completed clean
  under its explicit, tool-enforced immutable actual Terra High profile, made
  no Git mutation, spawned no child, and is closed.
- Canonical Wave 22 is clean: style/maintainability, documentation,
  TypeScript/API docs, and performance/reliability have accepted clean
  dispositions. All canonical participants are closed.
- T-0041 remains in progress only for the dedicated final security re-review,
  clean task gate, integration, remote synchronization, and cleanup.

## Dedicated Security Re-Review Assignment

- Fresh canonical-closure package
  `.superpowers/sdd/review-39f2c6f7..d72e264e.diff` contains 122 commits and
  908,199 bytes from literal baseline `39f2c6f7` to literal endpoint
  `d72e264e`.
- Assign the existing `security_reviewer`, expected explicit immutable
  `gpt-5.6-terra` / high, read-only, childless, and Git-read-only. Re-adjudicate
  every TM-001-TM-012 hypothesis and SF-001-SF-010 disposition across the full
  public/runtime/build/example/dependency scope, with exact evidence and the
  human ledger. Canonical review is clean; no historical superseded claim is
  active unless current status/security artifacts claim it.
- Report concrete unresolved security findings with prerequisite, boundary/
  asset, severity/confidence, evidence, current control, and smallest fix, or
  report the final security gate clean. Full `pnpm verify` follows only after a
  clean security result.

## Dedicated Security Re-Review Dispatch

- Security agent `019f656c-92bb-75f0-80e7-3f4bb8151057` was dispatched
  explicitly as the existing immutable `gpt-5.6-terra` / high role, read-only,
  childless, and Git-read-only, against the exact canonical-closure package.

## Dedicated Security Re-Review Result And Architecture Assignment

- Security agent `019f656c-92bb-75f0-80e7-3f4bb8151057` completed under its
  explicit, tool-enforced immutable actual Terra High profile, made no Git
  mutation, spawned no child, and is closed.
- Accepted Medium/high-confidence `SF-011`: same-UID trusted-directory ZeroMQ
  peers can send unlimited native frames because receiving sockets retain
  `maxMessageSize = -1` before V8 deserialization.
- Accepted Medium/high-confidence `SF-012`: corrupt/faulty-adapter durable
  subscription rows reach UTF-8/JSON/Base64 decoding without an encoded-byte
  ceiling, permitting disproportionate parse/allocation work.
- SF-001-SF-010 retain their dispositions. TM-001-TM-005 and TM-008-TM-012 are
  otherwise clean/accepted residuals; TM-006/TB-04 remains unresolved only for
  SF-012 and TM-007/TB-06 only for SF-011.
- Because exact native-frame limits and persisted-record compatibility are
  architecture/security-significant, assign the existing requirements splitter,
  expected explicit immutable `gpt-5.6-sol` / high, read-only and childless.
  Select exact private caps, socket coverage, pre-allocation checks, compatibility
  disposition, smallest TDD cases, canonical review relevance, and security
  re-review scope without changing public options, D-0088, Publisher timeout,
  copied contracts, or deployment ownership.

## SF-011/SF-012 Architecture Dispatch

- Requirements splitter `019f6575-3f28-7410-ae39-3ef51476c44b` was dispatched
  explicitly under the existing immutable `gpt-5.6-sol` / high role, read-only,
  childless, and Git-read-only, for only the exact private limits,
  compatibility, tests, mapping, and re-review scope.

## SF-011/SF-012 Architecture Result And Implementation Assignment

- Splitter `019f6575-3f28-7410-ae39-3ef51476c44b` completed under its explicit,
  tool-enforced immutable actual Sol High profile, made no Git mutation,
  spawned no child, and is closed.
- Accepted D-0091: one private 8,388,608-byte native receive cap on Subscriber,
  Request, and Reply before endpoints/native work; no Publisher cap or sender
  preflight. One private 33,554,432-byte durable `Any.value` cap at the first
  JSON-reader line before UTF-8/JSON/Base64/Protobuf work.
- Records at or below 32 MiB remain byte-compatible; larger values become inert
  malformed state outside the 4 MiB service-supported envelope. D-0087-D-0090,
  public/package/Proto/storage contracts, Publisher `sendTimeout = -1`, cleanup,
  retry, and deployment ownership remain unchanged.
- Keep SF-012 under clarified TM-006/TB-04 persisted replay/delivery availability;
  SF-011 remains TM-007/TB-06. Assign the existing implementer under its original
  immutable Terra Medium profile for two ordered TDD slices, D-0091/security
  artifacts, focused native transport/server verification, and no Git mutation.
  One complete four-lane canonical wave and focused security re-review follow.

## D-0091 Implementation Context Handoff

- The prior implementer context `019f64f8-06cf-7b03-adc9-5792d886d8ad` was
  resumed under its original immutable Terra Medium profile but produced no
  edits, verification, or blocker report within the bounded execution window.
  It is closed and unavailable for this batch; the worktree remained clean.
- Assign one fresh existing `implementer`, expected explicit immutable
  `gpt-5.6-terra` / medium, as sole writer for the already-decided D-0091 two-
  slice TDD batch. It must not re-plan the architecture or spawn children.

## D-0091 Fresh Implementer Dispatch

- Implementer `019f658b-c226-78d3-9079-88d275dcd054` was dispatched explicitly
  under the existing immutable `gpt-5.6-terra` / medium role as sole writer,
  childless and without Git-state mutation, for the exact D-0091 contract.

## D-0091 Coordinator Test Finding

- Final diff inspection found the raw Publisher-to-Subscriber and
  Request-to-Reply tests put 8,388,609 bytes in the routing frame. Existing
  route mismatch behavior could therefore preserve handler non-reachability
  without the D-0091 cap, so those cases do not prove the accepted envelope-
  frame control.
- Return the finding to implementer `019f658b-c226-78d3-9079-88d275dcd054`:
  send the exact valid routing key followed by an oversized serialized-envelope
  frame, preserve later valid continuation, and rerun focused plus complete
  native transport/server files from the final state. Also correct fresh-
  implementer provenance wording in the logs.

## D-0091 Implementation And Correction Verification

- SF-011 is implemented with one private `nativeMessageMaxBytes = 8_388_608`
  on `Subscriber`, `Request`, and `Reply` construction before native endpoint
  work. `Publisher` remains uncapped and retains `sendTimeout = -1`; no public
  option or sender preflight was added.
- SF-012 is implemented with one private `durableRecordMaxBytes = 33_554_432`
  as the first common JSON-reader operation. The exact error is
  `Durable subscription record exceeds 33554432 encoded bytes.` The compatible
  4 MiB arithmetic remains 4,194,351 binary bytes, 5,592,468 Base64 bytes, and
  30,758,240 JSON bytes.
- Focused and full affected-file correction verification is current. Complete
  four-lane canonical review and focused security re-review remain pending.

## D-0091 Coordinator Test Correction

- Corrected both raw Publisher-to-Subscriber and Request-to-Reply regressions
  to send the exact topic routing key as frame 1 and an 8,388,609-byte envelope
  as frame 2. Handler non-reachability now exercises the D-0091 receive cap;
  both cases retain later valid continuation.
- Fresh final-state verification passed the five focused transport security
  cases, the complete native transport file 53/53, and the complete affected
  server file 149/149. Focused ESLint, exact changed-path Prettier, and diff/
  anchor scans passed. Complete four-lane canonical review and focused security
  re-review remain pending.

## D-0091 Final Coordinator Verification

- Fresh coordinator-native verification passed the five focused durable-record
  cases, all 53 ZeroMQ transport tests, and all 149 server-service tests.
- Generated typecheck, docs/API generation and export counts, focused four-file
  ESLint, generated-output cleanliness, exact nine-path Prettier, public-root
  diff scan, and `git diff --check` passed. Generated output remains ignored
  and untracked.
- Source and test inspection confirms the native caps cover only receiving
  sockets, the durable cap precedes decoder/parser work, canonical Base64
  behavior remains enforced without the former whole-string regex, and raw
  publish/request cases use an exact route plus the oversized envelope frame.
  Complete four-lane canonical review and focused security re-review remain
  pending.

## Canonical Wave 23 Assignment

- Frozen D-0091 implementation endpoint: `da730e04`.
- Run all four canonical concerns against the complete T-0041 milestone because
  the fix changes runtime resource bounds, persistence decoding, behavior tests,
  and current security documentation.
- Assign the existing style/maintainability reviewer, expected explicit
  immutable `gpt-5.6-terra` / high; documentation reviewer, expected explicit
  immutable `gpt-5.6-luna` / medium; TypeScript/API docs reviewer, expected
  explicit immutable `gpt-5.6-terra` / high; and performance/reliability
  reviewer, expected explicit immutable `gpt-5.6-terra` / high. Every reviewer
  is read-only, childless, and Git-read-only.
- Reviewers must inspect only their bounded concern, the literal milestone
  package, affected paths, D-0091, and the human ledger. Historical superseded
  text is not a finding unless current task/status/security artifacts claim it
  as active.

## Canonical Wave 23 Pre-Review Lint

- The first status scan found stale top-level “implementation pending” headers
  and an obsolete Wave 22 pending row. They were corrected across task, work,
  review, findings, and threat-model active mirrors before packaging; older
  timestamped pending statements remain historical evidence only.
- Re-run status/stale scans are clean. Each D-0091 policy value has one private
  production owner, no D-0091 public-root/package/serialized change exists,
  changed public docs make no D-0091 claim, security docs retain deployment
  ownership rather than promising future policy, generated output is absent
  from Git status, formatting passes, and `git diff --check` passes.

## Canonical Wave 23 Package

- Literal package `.superpowers/sdd/review-39f2c6f7..ace8b0c3.diff` contains
  131 commits and 963,324 bytes from baseline `39f2c6f7` through endpoint
  `ace8b0c3`.
- Dispatch the four already-assigned immutable reviewer roles against this exact
  package and aggregate the complete wave before action.

## Canonical Wave 23 Dispatch Progress

- The initial concurrent dispatch reached shared Desktop thread capacity after
  launching the documentation and TypeScript/API lanes. This is platform
  sequencing, not a skipped concern; completed slots are reused for the
  remaining lanes.
- Documentation agent `019f65a4-6df3-7022-884d-9fa1c69621ec` completed clean
  under the explicit, tool-enforced immutable actual `gpt-5.6-luna` / medium
  profile and is closed.
- TypeScript/API agent `019f65a4-719e-7b72-95c6-11e419328364` completed clean
  under the explicit, tool-enforced immutable actual `gpt-5.6-terra` / high
  profile and is closed.
- Style agent `019f65a6-a66b-75e1-ae16-8393ee0648bf` is dispatched explicitly
  under the immutable `gpt-5.6-terra` / high role. Do not aggregate or fix until
  style and performance/reliability are both collected.

## Canonical Wave 23 Style Dispatch Correction

- The capacity-failed concurrent call had launched original style agent
  `019f65a4-6a9b-7361-9c09-57e9bb9b8e46` without returning its ID. It completed
  clean under the explicit, tool-enforced immutable actual Terra High profile
  and is closed.
- The later style dispatch `019f65a6-a66b-75e1-ae16-8393ee0648bf` was therefore
  a duplicate caused by the missing tool result. It was shut down while running;
  no result from it is accepted. Performance/reliability remains outstanding.

## Canonical Wave 23 Reliability Dispatch

- Performance/reliability agent `019f65a8-d035-7390-9ffc-1a3b4877e13f` is
  dispatched explicitly under the existing immutable `gpt-5.6-terra` / high
  role, read-only, childless, and Git-read-only, against the exact Wave 23
  package. Complete-wave aggregation waits for its result.

## Canonical Wave 23 Result

- Style/maintainability `019f65a4-6a9b-7361-9c09-57e9bb9b8e46`, actual
  immutable Terra High: clean.
- Documentation `019f65a4-6df3-7022-884d-9fa1c69621ec`, actual immutable Luna
  Medium: clean.
- TypeScript/API `019f65a4-719e-7b72-95c6-11e419328364`, actual immutable Terra
  High: clean.
- Performance/reliability `019f65a8-d035-7390-9ffc-1a3b4877e13f`, actual
  immutable Terra High: clean and closed after confirming cap placement,
  continuation, boundary compatibility, malformed-input parity, and bounded
  persistence behavior.
- All accepted reviewers performed the skill-applicability check, remained
  read-only/childless/Git-read-only, and are closed. Canonical Wave 23 is clean;
  generate the focused SF-011/SF-012 security package next.

## Focused SF-011/SF-012 Security Re-Review Assignment

- Literal package `.superpowers/sdd/review-d72e264e..be925aa3.diff` contains 12
  commits and 153,976 bytes from the previously accepted canonical/security
  endpoint `d72e264e` through Wave 23 closure `be925aa3`.
- Assign the existing `security_reviewer`, expected explicit immutable
  `gpt-5.6-terra` / high, read-only, childless, and Git-read-only. Re-adjudicate
  SF-011/TM-007/TB-06 and SF-012/TM-006/TB-04, plus any regression introduced
  by D-0091, without reopening accepted unrelated residuals or superseded text.
- Require concrete remaining finding evidence or an explicit clean result.
  Full `pnpm verify` follows only after clean focused security closure.

## Focused Security Re-Review Dispatch

- Security agent `019f65ae-5b69-7761-8323-d3ddfbc785d7` is dispatched
  explicitly under the existing immutable `gpt-5.6-terra` / high role,
  read-only, childless, and Git-read-only, against the exact focused package.

## Focused Security Re-Review Finding And Architecture Assignment

- Security agent `019f65ae-5b69-7761-8323-d3ddfbc785d7` completed under the
  explicit, tool-enforced immutable actual Terra High profile, made no Git
  mutation, spawned no child, and is closed.
- Accepted Medium/high-confidence SF-013: `maxMessageSize` limits each ZeroMQ
  frame rather than aggregate multipart bytes. The binding materializes all
  frames while transport handlers consume only the expected prefix, so a
  trusted-directory peer can append arbitrarily many cap-sized frames before
  any JavaScript framing rejection. SF-012 is clean.
- Because native receive semantics, aggregate allocation, and exact wire framing
  are architecture/security-significant, assign the existing requirements
  splitter, expected explicit immutable `gpt-5.6-sol` / high, read-only,
  childless, and Git-read-only. Determine the smallest enforceable aggregate/
  frame-count control, exact framing contract, compatibility, tests, and review
  scope without changing public options, Publisher timeout, or D-0088-D-0091.

## SF-013 Architecture Dispatch

- Requirements splitter `019f65b3-3f7a-7582-8c6f-a9ede2224dda` is dispatched
  explicitly under the existing immutable `gpt-5.6-sol` / high role, read-only,
  childless, and Git-read-only, for exact pinned-binding semantics, enforceable
  aggregate/frame controls, wire compatibility, TDD, review, and decision text.

## SF-013 Architecture Result And Private-Wire Follow-Up

- Splitter `019f65b3-3f7a-7582-8c6f-a9ede2224dda` completed under its explicit,
  tool-enforced immutable actual Sol High profile, made no Git mutation, and
  spawned no child. It established that zeromq.js 6.5.0 materializes the whole
  multipart `Buffer[]`; no binding option bounds aggregate frames before
  allocation. JavaScript exact-framing checks are defense in depth only.
- Preserving two-frame publish/request messages would require a new libzmq-level
  capability or explicit human acceptance of an unbounded same-host DoS
  residual. D-0088 does not require multipart framing, D-0091 is private, and
  the repository has no external users.
- Return one bounded follow-up to the same Sol High context: design a private
  single-frame route-plus-envelope format that preserves subscription prefix
  routing while making native `maxMessageSize` the true aggregate cap. Specify
  exact bytes/parsing, compatibility correction, tests, and replacement D-0092
  text; reject the approach if it cannot preserve exact routing safely.

## SF-013 Final Architecture Result And Blocking Question

- The same splitter context confirmed that one-frame conforming traffic still
  cannot close SF-013: a peer may append arbitrary multipart trailers, and
  zeromq.js materializes all parts before JavaScript can enforce exact-one-frame
  input. A NUL route delimiter would remove route-prefix ambiguity but not the
  allocation bypass. The splitter is closed.
- T-0041 is release-blocked pending one human choice: authorize replacement or
  native extension of the ZeroMQ receive path with pre-allocation frame-count
  and 8,388,608-byte aggregate enforcement, or explicitly accept the Medium/
  high-confidence same-UID local DoS residual. Risk acceptance would still
  require JavaScript exact-frame/aggregate defense in depth, raw-peer
  continuation regressions, canonical review, and focused security closure.
- D-0092 and the blocking question are recorded durably. No full verify,
  integration, push, or T-0042 work may claim progress until the choice is made.

## D-0093 Human Decision And Risk Acceptance

- The human rejected Node V8 serialization for Protobuf signal messages and
  explicitly required Buf's generated Protobuf binary serialization instead.
- The human retained 8,388,608 bytes as the hard per-frame inbound ceiling. The
  ceiling is not a fixed allocation: ordinary small routing and signal frames
  allocate their actual sizes plus normal native/runtime overhead.
- Normal traffic remains routing plus serialized signal. Receivers consume only
  the protocol-defined prefix, never more than the first two frames; later
  multipart frames are ignored. One-frame replies consume only their first
  meaningful frame.
- The human explicitly accepts SF-013 for the initial release and does not want
  a native receive replacement now. The accepted residual is that an authorized
  same-UID peer can append unlimited individually bounded frames that zeromq.js
  materializes before JavaScript ignores them.
- After full project completion, perform and report an Internet review of known
  ZeroMQ/libzmq and zeromq.js issues, discussions, and workarounds for this
  multipart-allocation behavior. This follow-up does not block initial release.
- D-0093 records the comments, decision, reasoning, and consequences. T-0041 is
  unblocked and must implement the Buf wire correction before final security
  re-review and task verification.

## D-0093 Skill Applicability And Architecture Assignment

- Session inventory, the complete bounded `~/.agents/skills` entrypoint scan,
  `build-protocol/skills/EXPECTED_SKILLS.md`, and readable
  `~/.agents/.skill-lock.json` were checked. Selected and read:
  `architecture-decision-records`, `subagent-driven-development`,
  `requesting-code-review`, `verification-before-completion`, and
  `using-git-worktrees`. `test-driven-development`, `implement`,
  `javascript-testing-patterns`, and `typescript-advanced-types` apply to the
  later implementation owner. Security skills remain relevant only to the
  focused final re-review. No install or network action is authorized by a
  skill.
- The existing T-0041 worktree is already isolated and clean; no additional
  worktree is needed.
- Because D-0093 changes a serialized signal boundary and may affect a public
  adapter-neutral interface, assign the existing `requirements_splitter`,
  expected explicit immutable `gpt-5.6-sol` / high, read-only, childless, and
  Git-read-only. It must preserve the human decisions verbatim, inspect the
  current transport/runtime contracts and generated schemas, and return the
  smallest compatible ownership seam, exact wire/reply treatment, TDD cases,
  docs, and bounded review scope. It must not revisit the accepted risk or add a
  native transport replacement.

## D-0093 Architecture Result And Implementation Assignment

- Requirements splitter `019f65eb-1eff-78d2-9bc7-cada7d23c056` completed with
  its explicitly dispatched, tool-enforced immutable actual `gpt-5.6-sol` /
  high profile. It completed the mandatory skill check, made no repository or
  Git changes, spawned no child, and is closed.
- Accept one private ZeroMQ codec correction. Dispatch by
  `TransportTopic.signalKind`: `command` uses `CommandSchema`, `event` uses
  `EventSchema`; `query`, `subscription`, and `system` retain their existing
  non-Proto V8 behavior because no Proto contract is in this task's scope.
- Command/Event send uses Buf `toBinary(..., { writeUnknownFields: false })`;
  receive uses `fromBinary(..., { readUnknownFields: false })`; a Proto codec
  error never falls back to V8. Runtime semantic and `Any.typeUrl` validation
  remains in `RuntimeTransportBinding`.
- Keep the public `SignalTransport` generics, roots, options, and factory source-
  compatible. Add only private transport-package dependencies/references on
  `@bufbuild/protobuf@2.12.1` and `@spine-ts/proto`; no public codec/schema API.
- Keep private one-frame `SignalIntakeResult`-compatible request replies and
  their non-Proto encoding. Do not misuse copied `AckSchema`; reject a generated
  Proto successful reply rather than V8-serializing it.
- PUB/SUB and REQ/REP requests consume exact route plus Proto payload from
  frames 1-2 and ignore trailers. Requesters consume only reply frame 1. Invalid
  Proto bytes do not reach handlers, use existing redacted failure behavior,
  and do not prevent later valid traffic.
- Assign one existing `implementer`, expected explicit immutable
  `gpt-5.6-terra` / medium, as sole writer in this worktree. It must perform the
  recorded skill check, use strict RED/GREEN TDD, preserve D-0088-D-0091 and
  public exports, update current docs/security records, run focused transport,
  runtime, cross-process, generated typecheck, lint, formatting, docs/API, and
  generated-clean checks, and make no commit or child-agent dispatch.
- Decision checkpoint commit `4b3c30cd` is pushed to
  `origin/task/T-0041-final-project-security-gate`.

## D-0093 Implementation Progress

- The sole implementation owner added private Buf wire dispatch for generated
  command/event envelopes, retained V8 for reserved non-Proto kinds and private
  request replies, and rejects generated Protobuf successful replies.
- Native IPC RED proved V8 outbound bytes, raw Buf handler non-reachability,
  and generated Proto reply acceptance before implementation. The focused Buf
  behavior tests and focused final-state checks are green; focused security
  re-review remains pending.
- SF-013 remains accepted and unbounded in aggregate: ignoring protocol
  trailers occurs only after zeromq.js materializes the multipart message.

## D-0093 Coordinator Acceptance

- Implementer `019f65f6-4f41-7131-9dea-882113a53f9e` ran under the explicitly
  dispatched, tool-enforced immutable actual `gpt-5.6-terra` / medium profile,
  completed the mandatory skill check and strict RED/GREEN cycles, made no Git
  state mutation, spawned no child, and is closed after correction acceptance.
- Coordinator inspection returned one missing proof: the initial reply-trailer
  test never supplied a trailer. The same context added a raw Reply peer; RED
  selected the final trailer and failed 1/1, while GREEN consumed frame 1,
  ignored two trailers, and kept Proto-reply rejection separate. The complete
  transport file passed 58/58.
- Fresh coordinator-native verification passed the complete transport, runtime
  transport, and server cross-process files: 3 files, 79 tests. Generated build
  typecheck, focused three-file ESLint, exact 14-path Prettier, generated docs
  and API export counts `100/28/205/19/17/6/3`, generated cleanliness, and
  `git diff --check` passed.
- Source/dependency/doc inspection accepts exact private Command/Event Buf wire,
  no Proto-to-V8 fallback, unchanged public roots/signatures, private non-Proto
  result replies, prefix-only frame use, the 8 MiB per-frame cap, and honest
  SF-013 accepted-residual wording. Freeze and commit the implementation, then
  run pre-review lint and all four relevant canonical concerns before focused
  final security re-review.
- D-0093 implementation commit: `031f497e`.

## D-0093 Canonical Wave Result And Architecture Follow-Up

- All four assigned reviewers completed mandatory skill checks under matching
  explicit/tool-enforced immutable actual profiles, made no repository/Git
  mutation, spawned no child, and are closed: style
  `019f660c-3140-7bb3-bfb5-3ba26c100799` Terra High; documentation
  `019f660c-6fbd-70d0-bf6d-7c20c88a959f` Luna Medium; TypeScript/API
  `019f660c-af27-7fa0-9fdb-24c1243c3030` Terra High; performance/reliability
  `019f660c-ed5f-7170-93b3-172d5316e831` Terra High.
- Accepted P1: public `SignalTransport` generics still promise any envelope for
  every kind, while the ZeroMQ adapter now treats `command` and `event` as
  concrete generated `Command`/`Event`. Moving generic tests to `system` hid
  rather than resolved that type/runtime mismatch.
- Accepted P2: generated-Proto reply rejection currently treats any object with
  a string `$typeName` as Proto, rejecting legitimate plain private replies that
  use that property.
- Accepted bounded corrections: align stale explicit test generic kinds with
  `system`; decode/assert the malformed-command generic failure; prove a later
  valid request after Proto-reply rejection; and complete the three wire docs
  with exact 8 MiB rejection/non-allocation semantics, frame positions, private
  non-`Ack` reply/rejection, and coordinated-peer incompatibility.
- Because the P1 correction changes a public type contract and the prior
  architecture packet's source-compatibility assumption is disproven, resume
  the same requirements splitter context
  `019f65eb-1eff-78d2-9bc7-cada7d23c056`, expected explicit immutable
  `gpt-5.6-sol` / high, read-only, childless, and Git-read-only. Select the
  smallest honest kind-to-envelope type correlation, exact compatibility/docs/
  tests, and narrow generated-Proto reply detection without reopening the human
  wire/risk decisions or adding a codec-option abstraction.

## D-0094 Architecture Result And Fix Assignment

- Resumed splitter `019f65eb-1eff-78d2-9bc7-cada7d23c056` retained matching
  explicit/tool-enforced immutable actual Sol High, used the applicable
  `codebase-design` and `typescript-advanced-types` skills, made no Git or file
  mutation, spawned no child, and is closed.
- Accept public `TransportSignalEnvelope<Kind, OtherEnvelope>`: command resolves
  to generated `Command`, event to generated `Event`, and other kinds retain
  their caller-selected envelope. Apply it without changing existing generic
  argument order. Root exports intentionally become 18; ZeroMQ stays 6.
- Adjust the splitter's reply predicate to preserve the binding human rule:
  use Buf `isMessage(value)` without a schema and reject every generated-
  message-shaped successful reply. Schema-specific Command/Event checks would
  let another Proto such as `Ack` fall through to V8. Document string
  `$typeName` as reserved on the ZeroMQ private reply seam.
- Resume the same implementer context
  `019f65f6-4f41-7131-9dea-882113a53f9e`, expected its original explicit/
  tool-enforced immutable `gpt-5.6-terra` / medium profile, as sole writer,
  childless and without Git-state mutation. Implement D-0094 plus the complete
  accepted canonical batch under RED/GREEN; update exact API export checks and
  all active records/docs; run focused root/ZeroMQ/runtime/cross-process,
  generated typecheck, lint, formatting, docs/API, generated-clean, and diff
  checks. No full verify before re-review closure.

## D-0094 Implementation Progress

- Added the public `TransportSignalEnvelope` conditional and applied it to
  operation and handler envelope types without changing generic or method
  order. Command/event now correlate with generated `Command`/`Event`; other
  kinds preserve caller-selected types. The intentional root/subpath counts are
  18/6.
- The private ZeroMQ reply guard now uses Buf `isMessage(value)` without a
  schema. Generated-message-shaped results, including string `$typeName`, are
  rejected; plain private objects remain supported and are not Spine `Ack`.
- Compile/runtime RED/GREEN and focused final checks are recorded in the work
  log. Canonical and final security re-review remain pending.

## D-0094 Coordinator Acceptance For Re-Review

- The coordinator independently inspected the conditional public contract,
  schema-free Buf reply guard, exact malformed-command reply assertion,
  continuation behavior, affected server fixtures, API checker, and current
  public/security documentation. The implementation matches D-0093 and D-0094.
- Fresh native verification passed 4 files / 87 tests for transport, runtime,
  and cross-process behavior and 2 files / 63 tests for the additionally
  affected server lifecycle paths. Tooling and generated build typechecks,
  focused ESLint, generated API docs at counts `100/28/205/19/18/6/3`, Proto
  generated cleanliness, exact changed-path Prettier, and `git diff --check`
  all passed.
- Implementer `019f65f6-4f41-7131-9dea-882113a53f9e` retained its explicit and
  actual immutable Terra Medium profile, remained childless and without Git
  mutation, and is closed. Exactly the 16 assigned paths remain modified.
- This is acceptance to freeze and re-review the correction, not task closure.
  All four canonical concerns must re-review it; the focused final security
  review follows only after canonical closure.

## D-0094 Pre-Review Lint

- Current task, work, review, security, and threat-model status consistently
  says implementation is accepted and re-review is pending. Historical
  superseded text remains chronology, not active state.
- `nativeMessageMaxBytes` and the command/event kind-to-schema dispatch each
  have one private production owner. Repeated test values are assertions, not
  competing policy sources.
- `TransportSignalEnvelope` is the sole intentional public addition. Buf
  schemas, socket/frame mechanics, and reply wrappers remain private; the exact
  root/subpath API counts are 18/6 and generated outputs remain absent from Git.
- Changed public docs state current behavior, coordinated-peer incompatibility,
  explicit exclusions, and accepted SF-013 risk without promising a future
  codec, topology, scheduler, monitor, backoff, catch-up, or remote adapter.
  The compact correction is ready for all four canonical lanes.

## D-0094 Canonical Re-Review Assignment

- Frozen endpoint `cfd8658a`; correction baseline `f37c3801`; package
  `.superpowers/sdd/review-f37c3801..cfd8658a.diff`; 2 commits; 73,613 bytes.
- Dispatch the existing style/maintainability reviewer as explicit immutable
  Terra High, documentation reviewer as explicit immutable Luna Medium,
  TypeScript/API reviewer as explicit immutable Terra High, and performance/
  reliability reviewer as explicit immutable Terra High.
- Every reviewer is read-only, childless, Git-read-only, limited to this
  correction and affected paths, and must ignore superseded historical text
  unless current task records or changed docs claim it as active. Aggregate the
  entire wave before accepting findings or assigning a correction.

## D-0094 Canonical Re-Review Result

- Style/maintainability `019f6635-f851-7982-9b05-6f2a365ff5c6`, explicit and
  tool-enforced actual immutable Terra High: accepted the widened-kind
  correlation defect and one duplicated transport-only test in the server
  runtime suite; closed.
- Documentation `019f6635-fbf3-7d01-90b8-b31f79313cfd`, explicit and
  tool-enforced actual immutable Luna Medium: accepted two ambiguous frame-2
  Buf claims and an active security header that still names a superseded
  package/reviewer; closed.
- TypeScript/API `019f6635-ff98-7861-81f6-8fdc2ecadeb6`, explicit and
  tool-enforced actual immutable Terra High: independently reproduced the
  high-severity widened-kind correlation defect; closed.
- Performance/reliability `019f6636-0300-74e2-8016-6ce36ae87e54`, explicit and
  tool-enforced actual immutable Terra High: clean within the accepted SF-013
  residual; closed.
- The complete wave is aggregated. Correct the operation shapes as a
  distributive tagged union over `Kind`, add widened/union compile-time
  regressions, remove the duplicated server test, qualify frame-2 docs by kind,
  and replace the stale active security assignment. Re-review affected lanes;
  reliability may retain its clean disposition because no runtime behavior is
  intended to change.

## D-0094 Union-Correlation Fix Assignment

- Resume existing implementer `019f65f6-4f41-7131-9dea-882113a53f9e` under
  its original explicit/tool-enforced immutable `gpt-5.6-terra` / medium
  profile. It remains the sole writer, childless, and without staging, commit,
  branch, or push operations.
- Own only the deduplicated wave: distributive publish/request operation shapes
  with preserved generic order, compile-time union/widened-kind regressions,
  removal of the duplicated transport-only server test, exact frame-2 wording,
  and replacement of the superseded active security assignment.
- Use RED/GREEN for the type hole and run focused transport type/runtime, docs,
  lint, formatting, generated-clean, and diff checks. Do not alter the runtime
  codec, frame cap, trailer behavior, accepted SF-013 decision, or run full
  `pnpm verify` in this inner loop.

## D-0094 Union-Correlation Fix Implementation

- The publish/request operation aliases are now distributive tagged unions over
  `Kind`, preserving generic argument order and literal-kind/non-Proto behavior
  while keeping each topic correlated with its generated or caller-selected
  envelope. Public handler aliases retain their existing order and signatures;
  only adapter-private erased handler storage changed to accommodate the
  corrected public union, with no wire/runtime logic change.
- Compile-time regressions reject plain command/event envelopes through widened
  and union `Kind` operation aliases and through explicit generic
  `SignalTransport.publish()`/`request()` calls. Valid generated widened values
  and reserved-kind caller envelopes remain accepted.
- The duplicated server-runtime direct ZeroMQ reply test is removed; the unique
  generated-reply continuation and reserved `$typeName` coverage remains in the
  transport adapter suite. Both public wire docs now distinguish Buf frame 2
  for command/event from private V8 frame 2 for reserved kinds.
- Exact RED/GREEN and focused final evidence are recorded in the work log.
  Implementation is complete; style, documentation, and TypeScript/API
  re-review are pending. Reliability remains unchanged because runtime behavior
  did not change, and focused final security has not yet been dispatched.

## D-0094 Union-Correlation Coordinator Acceptance

- Coordinator inspection accepts the distributive operation aliases, four
  widened/union compile regressions, adapter-private type erasure, duplicate
  test removal, exact frame-2 wording, and historical security assignment.
  Runtime codec/frame/socket logic is unchanged.
- Fresh coordinator checks passed both tooling and generated build typechecks,
  the complete affected transport/runtime suite at 3 files / 79 tests, focused
  ESLint, generated docs/API counts `100/28/205/19/18/6/3`, Proto cleanliness,
  exact 11-path Prettier, and `git diff --check`.
- Implementer `019f65f6-4f41-7131-9dea-882113a53f9e`, explicit and actual
  immutable Terra Medium, remained sole writer, childless, and without Git
  mutation and is closed. Freeze this correction and re-review style,
  documentation, and TypeScript/API. Reliability's clean disposition remains
  valid because no runtime execution path changed.

## D-0094 Union-Correlation Pre-Review Lint

- Current task/work/review/security headers agree that implementation is
  complete and affected canonical re-review is pending. The old final-security
  package and reviewer are explicitly historical, with no replacement claimed.
- The private 8 MiB cap and codec dispatch retain one production owner each.
  Distributive operation aliases add no schema/socket/reply public leakage and
  exact API counts remain 18 root / 6 ZeroMQ.
- Changed docs now state Buf frame 2 only for command/event and private V8 for
  reserved kinds. No future codec, topology, scheduler, monitor, backoff,
  catch-up, or remote-adapter policy is promised; generated outputs remain
  absent from Git.
- Style, documentation, and TypeScript/API are affected. Performance/
  reliability remains N/A for another wave because inspection and diff show no
  runtime execution-path change and its prior clean disposition remains valid.

## D-0094 Union-Correlation Re-Review Assignment

- Frozen endpoint `deac2198`; baseline `6f0ea76e`; exact package
  `.superpowers/sdd/review-6f0ea76e..deac2198.diff`; 2 commits; 46,504 bytes.
- Dispatch existing style/maintainability and TypeScript/API reviewers under
  explicit immutable Terra High and documentation under explicit immutable
  Luna Medium. All are read-only, childless, Git-read-only, correction-scoped,
  and subject to the historical-text rule.
- Performance/reliability retains N/A for this wave because no runtime
  execution path changed. Aggregate all three affected results before any
  further correction; focused final security follows only after clean closure.

## D-0094 Union-Correlation Re-Review Result

- Style `019f664b-74bf-76a0-9523-6d3df4e85ea8`, explicit/tool-enforced actual
  immutable Terra High: clean; closed.
- Documentation `019f664b-78c8-7e91-ae30-776b9bd58c1e`, explicit/tool-enforced
  actual immutable Luna Medium: clean; closed.
- TypeScript/API `019f664b-70fd-7753-94ed-01f285973de3`, explicit/tool-enforced
  actual immutable Terra High: accepted P1 that invalid union pairs are
  rejected but valid union handlers cannot narrow envelope type by the nested
  `operation.topic.signalKind`; widened topics are similarly hard to consume;
  closed.
- Performance/reliability retains its recorded N/A and prior clean result.
  Resume the existing requirements splitter under Sol High for only the
  smallest honest discriminable public contract. Preserve method generic order,
  runtime wire behavior, and D-0093 decisions; do not automatically add a
  top-level field or helper without comparing compatibility and inference.

## D-0094 Discriminable-Union Architecture Assignment

- Resume requirements splitter `019f65eb-1eff-78d2-9bc7-cada7d23c056`, expected
  original explicit/tool-enforced immutable `gpt-5.6-sol` / high, read-only,
  childless, and Git-read-only.
- Compare the smallest public designs that make valid widened/union operations
  constructible and narrowable while rejecting invalid topic/envelope pairs.
  Include exact compatibility, inference, declaration, docs/export, and compile
  tests. Preserve public method generic order and every runtime wire/risk
  decision; return one recommendation, not implementation.

## D-0095 Discriminable-Union Architecture Result And Fix Assignment

- Splitter `019f65eb-1eff-78d2-9bc7-cada7d23c056`, explicit/actual immutable Sol
  High, selected additive overloaded `hasTransportSignalKind()` over a duplicated
  top-level discriminator or public topic/operation reshaping; it remained
  read-only, childless, Git-read-only, and is closed.
- D-0095 records the helper as a narrowing predicate over canonical
  `topic.signalKind`, not runtime input/envelope validation. Existing operation
  shapes and generic order remain unchanged; root exports become 19 and ZeroMQ
  remains 6.
- Resume implementer `019f65f6-4f41-7131-9dea-882113a53f9e`, expected original
  explicit/tool-enforced immutable Terra Medium, sole writer, childless, and
  without Git mutation. RED/GREEN must prove the exact overload with this
  TypeScript version; if it fails, stop and return to architecture rather than
  adding duplicated discriminants or broader type reshaping.

## D-0095 Implementation And Coordinator Acceptance

- Added overloaded `hasTransportSignalKind()` exactly as the canonical-kind
  narrowing aid. It reads only `topic.signalKind`, uses `NoInfer` to prevent the
  requested kind from widening restricted sources, and narrows publish/request
  operations and topics without changing their object shape or generic order.
- RED tooling failed on the missing helper, four operation narrowing assertions,
  two topic/routing narrowing assertions, and two unused restricted-kind
  rejection markers. GREEN consumes every marker and root runtime tests prove
  true/false results without envelope access or mutation.
- Fresh coordinator checks passed both typechecks, transport root 8/8, focused
  ESLint, docs/API counts `100/28/205/19/19/6/3`, Proto cleanliness, exact
  eight-path Prettier, and diff integrity. No ZeroMQ/server path changed.
- Implementer `019f65f6-4f41-7131-9dea-882113a53f9e`, explicit/actual immutable
  Terra Medium, remained sole writer, childless, and without Git mutation and is
  closed. Freeze and re-review style, docs, and TypeScript/API; reliability
  remains N/A under D-0095.

## D-0095 Pre-Review Lint

- Current task/work/review statuses agree that D-0095 implementation is
  complete and affected re-review is pending. D-0095 is accepted and no final
  security dispatch is claimed.
- `hasTransportSignalKind()` is the sole intentional public addition, exact
  root/subpath counts are 19/6, and no schema, validator, ZeroMQ, or server
  concept leaked. The helper reads one canonical kind and owns no duplicated
  policy constant.
- Public docs explicitly distinguish type narrowing from untrusted-input and
  envelope validation and make no future-policy claim. One mechanical API
  overview line was wrapped; generated output remains absent from Git.
- Style, documentation, and TypeScript/API are affected. Performance/
  reliability remains N/A because the helper is stateless equality with no I/O,
  lifecycle, allocation, timing, or adapter execution-path effect.

## D-0095 Canonical Re-Review Assignment

- Frozen endpoint `836ff533`; baseline `255c26c1`; exact package
  `.superpowers/sdd/review-255c26c1..836ff533.diff`; 2 commits; 32,487 bytes.
- Dispatch existing style/maintainability and TypeScript/API roles as explicit
  immutable Terra High and documentation as explicit immutable Luna Medium.
  All are read-only, childless, Git-read-only, helper-scoped, and subject to the
  historical-text rule.
- Reliability remains N/A under the recorded stateless equality/no-I/O/no-
  execution-path rationale. Aggregate all three affected results before final
  canonical closure or another correction.

## D-0095 Canonical Re-Review Result And Fix Assignment

- Style `019f6665-7053-75b1-a79a-f9fd1fb4eea4`, explicit/actual immutable Terra
  High: accepted Medium overbroad operation overload that admits subscriptions
  and narrows them to `never`; closed.
- Documentation `019f6665-7582-7b83-9bb4-8ffe3902836c`, explicit/actual
  immutable Luna Medium: accepted P2 active release-matrix transport count 17
  versus current 19 at three locations; closed.
- TypeScript/API `019f6665-78ec-7911-8dd6-b2e07cced2b4`, explicit/actual
  immutable Terra High: accepted High structural-topic misclassification when
  a valid topic also has a `topic` property; closed.
- Reliability remains N/A. Resume implementer
  `019f65f6-4f41-7131-9dea-882113a53f9e`, expected original explicit immutable
  Terra Medium, sole writer and childless. Restrict operation narrowing to an
  envelope-bearing operation, prioritize top-level `signalKind` for topic
  values, add compile/runtime regressions, and update the three active counts.

## D-0095 Structural-Collision Coordinator Finding

- The first bounded fix correctly excludes subscriptions and fixes a topic with
  an extra nested `topic` by prioritizing top-level `signalKind`, but coordinator
  inspection found the symmetric unsound case: an envelope-bearing operation
  may structurally carry an extra top-level `signalKind` and be misclassified as
  a topic. A value may otherwise satisfy both overload domains with conflicting
  canonical kinds.
- Reject the intermediate fix before commit/re-review. Make overload domains
  statically disjoint, for example by excluding `signalKind` from operation
  inputs and excluding `topic` from topic inputs with optional-`never` members.
  Add compile regressions rejecting both ambiguous intersections and runtime
  proof for each accepted non-ambiguous domain. Preserve D-0095 and do not turn
  the helper into runtime validation.

## D-0095 Review-Batch Coordinator Acceptance

- Final overload domains are disjoint: operations require `envelope` and
  exclude top-level `signalKind`; topics exclude nested `topic`. Subscriptions
  and both ambiguous intersections are compile-rejected, while ordinary
  publish/request operations and topics remain narrowable.
- Runtime forced-collision behavior is deterministic but explicitly outside the
  typed narrowing domains. The helper remains a narrowing aid, not input
  validation. The three active release-matrix transport counts are now 19.
- Fresh coordinator checks passed both typechecks, transport root 9/9, focused
  ESLint, docs/API counts `100/28/205/19/19/6/3`, Proto cleanliness, exact
  six-path Prettier, and diff integrity. No ZeroMQ/server path changed.
- Implementer `019f65f6-4f41-7131-9dea-882113a53f9e`, explicit/actual immutable
  Terra Medium, remained sole writer, childless, and Git-clean and is closed.
  Freeze and re-review style, docs, and TypeScript/API; reliability stays N/A.

## D-0095 Review-Batch Pre-Review Lint

- Current task/work/review statuses agree on implementation complete/re-review
  pending. Active release-matrix transport counts are 19; older 17-count entries
  remain historical evidence only.
- Helper overload domains are disjoint, own no duplicated runtime policy, and
  expose no schema/validator/adapter/server concept. Root/subpath counts remain
  intentionally 19/6 and generated output is absent.
- Docs retain narrowing-not-validation and no-future-policy wording. Style,
  docs, and TypeScript/API re-review this correction; reliability remains N/A
  under D-0095's stateless/no-I/O/no-execution-path rationale.

## D-0095 Soundness Re-Review Assignment

- Frozen endpoint `9cf19932`; baseline `a0b7993c`; exact package
  `.superpowers/sdd/review-a0b7993c..9cf19932.diff`; 2 commits; 54,397 bytes.
- Dispatch style/maintainability and TypeScript/API as explicit immutable Terra
  High and documentation as explicit immutable Luna Medium. All existing roles
  are read-only, childless, Git-read-only, correction-scoped, and subject to the
  historical-text rule.
- Reliability remains N/A. Aggregate all three affected results before closure
  or another complete fix batch.

## D-0095 Soundness Re-Review Result And Architecture Escalation

- Documentation `019f6677-9a9e-7a23-8db4-8f2098259dc1`, explicit/actual
  immutable Luna Medium: clean; closed.
- Style `019f6677-a17f-76c2-b8a9-9216cc3a1325`, explicit/actual immutable Terra
  High: accepted P2 inaccurate claim that runtime implementation was unchanged;
  only helper collision classification changed, not wire/adapter/server paths;
  closed.
- TypeScript/API `019f6677-9e5b-7381-a639-143d3b9d4295`, explicit/actual
  immutable Terra High: accepted P1 that open/index-signature structural types
  bypass optional-`never` and restore a false predicate guarantee; closed.
- D-0095's explicit return-to-architecture condition is met. Resume splitter
  `019f65eb-1eff-78d2-9bc7-cada7d23c056`, expected original explicit immutable
  Sol High, read-only/childless/Git-read-only. Reconsider the single overloaded
  helper versus separate operation/topic predicates or a mechanically sound
  key-exclusion design. Preserve generic order and all wire decisions.

## D-0096 Architecture Result And Fix Assignment

- Splitter `019f65eb-1eff-78d2-9bc7-cada7d23c056`, explicit/actual immutable Sol
  High, selected separate `isTransportOperationKind()` and
  `isTransportTopicKind()` predicates, remained read-only, childless,
  Git-read-only, and is closed.
- D-0096 supersedes only D-0095's overloaded helper. Function identity fixes the
  runtime path for open/index-signature and dual-shaped values; no negative-key
  proof or shape classification remains. Root exports become 20; ZeroMQ stays 6.
- Resume implementer `019f65f6-4f41-7131-9dea-882113a53f9e`, expected original
  explicit immutable Terra Medium, sole writer, childless, and without Git
  mutation. Replace the unmerged helper, add the full open/dual-shape RED/GREEN
  matrix, update docs/checker/matrix/logs, and correct the P2 runtime wording.
  No ZeroMQ/server changes or full verify.

## D-0096 Implementation And Coordinator Acceptance

- Removed the unmerged overloaded helper and added separate fixed-path
  `isTransportOperationKind()` and `isTransportTopicKind()` predicates. Open/
  index-signature refinements and dual-shaped values remain sound because each
  function always reads its named canonical path; neither reads envelopes.
- RED tooling/root tests proved both missing helpers and unresolved narrowing.
  GREEN covers widened/restricted publish, request, and topic inputs, open and
  dual-shaped values, invalid pair preservation, truthful path results, and zero
  envelope access.
- Coordinator passed both typechecks, transport root 9/9, focused ESLint,
  docs/API counts `100/28/205/19/20/6/3`, Proto cleanliness, exact nine-path
  Prettier, and diff integrity. Active matrix counts are 20; no old helper,
  optional-`never`, ZeroMQ/server path, or generated output remains.
- Implementer `019f65f6-4f41-7131-9dea-882113a53f9e`, explicit/actual immutable
  Terra Medium, remained sole writer, childless, and Git-clean and is closed.
  Freeze and re-review style, docs, and TypeScript/API; reliability remains N/A.

## D-0096 Pre-Review Lint

- Current task/work/review statuses agree on D-0096 implementation complete and
  re-review pending. Old-helper and optional-negative-key matches are historical
  chronology only; current source/docs/checker contain neither.
- Two intentional predicate exports produce 20/6 counts, active matrix claims
  are 20, no policy duplication or schema/validator/adapter/server leakage is
  present, and generated output is absent.
- Docs distinguish the two fixed paths and narrowing from validation, with no
  future-policy overclaim. Style, docs, and TypeScript/API re-review; reliability
  remains N/A under D-0096's stateless/no-I/O/no-adapter-path rationale.

## D-0096 Canonical Re-Review Assignment

- Frozen endpoint `3a6026a4`; baseline `caf59f58`; exact package
  `.superpowers/sdd/review-caf59f58..3a6026a4.diff`; 2 commits; 71,736 bytes.
- Dispatch existing style/maintainability and TypeScript/API as explicit
  immutable Terra High and documentation as explicit immutable Luna Medium.
  All are read-only, childless, Git-read-only, D-0096-scoped, and subject to the
  historical-text rule.
- Reliability remains N/A. Aggregate all three affected results before closure
  or any complete fix batch.

## D-0096 Canonical Re-Review Result And Fix Assignment

- Documentation `019f668d-b7de-7fa1-9d33-6e2335d80b6c`, explicit/actual
  immutable Luna Medium: clean; closed.
- Style `019f668d-b3dc-76c2-a390-003979feacb2`, explicit/actual immutable Terra
  High, and TypeScript/API `019f668d-bb15-7183-8edd-132e8c17e065`, explicit/
  actual immutable Terra High, independently accepted the same P1: the topic
  predicate checks only top-level `signalKind` but also narrows unobserved
  `routing.signalKind`; both are closed.
- Reliability remains N/A. Resume implementer
  `019f65f6-4f41-7131-9dea-882113a53f9e`, expected original immutable Terra
  Medium, sole writer/childless/Git-read-only. Narrow only the observed top-level
  field, add a cast-free inconsistent widened-topic regression proving routing
  remains widened, and correct tests/docs/logs. Preserve all D-0096 fixed paths,
  names, counts, and transport runtime scope.

## D-0096 Fixed-Path Predicate Implementation

- Removed unmerged `hasTransportSignalKind()` without an alias. Added
  `isTransportOperationKind()` with the operation-union/`NoInfer`/`Extract`
  contract and fixed nested `operation.topic.signalKind` path, plus
  `isTransportTopicKind()` with a fixed top-level `topic.signalKind` path and
  preservation of open caller refinements.
- RED tooling exited 2 for missing exports and unresolved desired narrowing;
  runtime failed 2 of 9 because both functions were undefined. GREEN tooling
  exits 0 and root tests pass 9/9 across widened/restricted/open/dual-shaped
  inputs, retained invalid pairs, and zero envelope reads.
- Docs/checker use both names, root/ZeroMQ counts are 20/6, and exactly three
  active matrix claims are 20. Public helper runtime changed; only adapter,
  server, wire, frame, allocation, and lifecycle paths remained unchanged. No
  validation semantics or collision rejection remains.
- Final focused evidence is recorded in the work log. D-0096 implementation is
  complete; affected re-review remains pending.
- Final focused gates are green: both typechecks and focused lint exited 0,
  root tests passed 9/9, generated docs reported `100/28/205/19/20/6/3`, and
  Proto/generated/diff/status/old-helper/forbidden-scope scans are clean and
  limited to exactly nine assigned paths. D-0096 re-review remains pending.

## D-0095 Narrowing Helper Implementation Progress

- The project TypeScript version accepts the additive overloaded
  `hasTransportSignalKind()` design. It narrows distributive publish/request
  operations through `Extract` and widened topics through their generic kind,
  while rejecting kinds outside a restricted operation/topic union.
- The implementation compares only canonical `topic.signalKind`; operation and
  topic shapes, envelopes, method generic order, and every wire/runtime path are
  unchanged. Runtime tests use frozen values and an observable envelope getter
  to prove true/false comparison without envelope inspection or mutation.
- Root/API export expectation is intentionally 19/6. Public docs describe
  widened-handler use and state explicitly that the helper is type narrowing,
  not validation of untrusted input or envelope content.
- Exact RED/GREEN and final verification evidence are recorded in the work log:
  both required typechecks and focused lint exited 0, transport-root tests
  passed 8/8, generated docs passed with `100/28/205/19/19/6/3`, and generated
  Proto outputs are clean. D-0095 implementation is complete; affected
  re-review remains pending.

## D-0095 Canonical Re-Review Batch Implementation

- Restricted operation narrowing to envelope-bearing transport operations, so
  `TransportSubscription` and other topic-only containers are rejected while
  publish/request unions retain canonical-kind narrowing and restricted-kind
  rejection.
- Runtime helper classification now gives a structural `TransportTopic`'s
  top-level `signalKind` precedence over any extra nested `topic`. Regression
  coverage proves a canonical event topic with a nested command topic is event
  only and narrows without `never`.
- Updated exactly the three active release-matrix transport-root claims from 17
  to 19. D-0095 name, docs semantics, public shapes/generic order, 19/6 counts,
  and every runtime transport path remain unchanged.
- Strict compile/runtime RED and initial GREEN are recorded in the work log;
  final focused verification evidence follows there. Implementation is complete
  and canonical re-review remains pending.
- Final evidence is green: both typechecks and focused lint exited 0,
  transport-root tests passed 9/9, generated docs reported
  `100/28/205/19/19/6/3`, Proto/generated scans are clean, and diff/status/scope
  scans contain exactly the six assigned paths with no ZeroMQ/server changes.
  Implementation remains complete; canonical re-review is pending.

## D-0095 Symmetric-Collision Coordinator Correction

- Made the narrowing overload domains statically disjoint without changing
  public operation shapes: operation inputs require `envelope` and exclude
  top-level `signalKind`; topic inputs exclude nested `topic`, using symmetric
  optional-`never` members only at the helper seam.
- Compile regressions reject both ambiguous intersections while ordinary
  topics, publish/request operations, restricted kind unions, and subscription
  rejection retain their intended behavior. The prior top-level runtime
  precedence regression remains explicitly outside the accepted overload
  domains, and accepted-domain runtime proof does not claim validation.
- Strict RED tooling exited 2 with four unused collision markers. GREEN tooling
  exited 0 and the complete transport-root file passed 9/9. Final focused
  evidence is recorded in the work log. Implementation is complete; canonical
  re-review remains pending.
- Final focused gates are green: both typechecks and focused lint exited 0,
  root tests passed 9/9, docs reported `100/28/205/19/19/6/3`, and
  Proto/generated/diff/status/forbidden-scope scans are clean and limited to
  exactly six assigned paths. Implementation remains complete; canonical
  re-review is pending.

## D-0096 Top-Level-Only Topic Narrowing Correction

- Corrected only the accepted public type-guard finding:
  `isTransportTopicKind()` still reads exactly `topic.signalKind`, but now
  narrows only that observed top-level member. It does not inspect, validate, or
  narrow `routing.signalKind`.
- Added a cast-free widened `TransportTopic` with top-level `command` and
  routing `event`. The compile contract proves the top-level member narrows to
  `command` while routing remains `TransportSignalKind`; runtime proves the
  helper returns true for command and the routing value remains event.
- Strict RED/GREEN and final focused evidence are recorded in the work log.
  Public names and 20/6 exports, operation/topic shapes and method generic
  order, adapters/server/wire/framing/allocation/lifecycle/generated Proto, and
  security policy are unchanged. Implementation is complete; affected D-0096
  re-review remains pending.
- Final focused gates are green: both requested typechecks and focused lint
  exited 0, transport-root tests passed 10/10, generated docs reported exact
  API counts `100/28/205/19/20/6/3`, and Proto generation is clean. Exact
  formatting/diff/status/generated/forbidden-scope evidence is recorded in the
  work log; affected D-0096 re-review remains pending.

## D-0096 Top-Level-Only Coordinator Acceptance

- Coordinator inspection accepts the top-level-only predicate guarantee, the
  cast-free inconsistent-topic regression, and both public documentation
  corrections. Runtime comparison, operation narrowing, names, 20/6 exports,
  public shapes/generic order, and every adapter/server/wire/security decision
  remain unchanged.
- Fresh coordinator checks passed tooling and generated-build typechecks,
  transport root 10/10, focused ESLint and exact seven-path formatting,
  generated docs/API counts `100/28/205/19/20/6/3`, Proto cleanliness, and diff
  integrity. Implementer `019f65f6-4f41-7131-9dea-882113a53f9e` retained its
  explicit/tool-enforced actual immutable Terra Medium profile, remained
  childless and Git-read-only, and is closed. Freeze and commit this correction,
  then run pre-review lint and the three affected canonical lanes; reliability
  remains N/A because no execution path changed.

## D-0096 Top-Level-Only Pre-Review Lint

- The lightweight status scan found one active-state defect: the security
  findings and threat-model headers still named D-0094 as the latest pending
  correction. Corrected those active mirrors to D-0096 and added the exact
  top-level-only predicate boundary before packaging; historical chronology is
  unchanged.
- Source, tests, docs, checker, release matrix, task/work/review headers, and
  D-0096 now agree on two fixed paths, top-level-only topic narrowing, and 20/6
  exports. No duplicated production policy constant, unintentional public
  adapter/schema/frame leakage, generated output, routing-validation claim, or
  future-policy overclaim was found. Reliability remains N/A.

## D-0096 Top-Level-Only Re-Review Assignment

- Frozen correction baseline `93d4dff9`; endpoint `f3006a14`; exact package
  `.superpowers/sdd/review-93d4dff9..f3006a14.diff`; 2 commits; 42,134 bytes.
- Dispatch existing style/maintainability and TypeScript/API reviewers under
  explicit immutable Terra High and documentation under explicit immutable
  Luna Medium. Each lane is read-only, childless, Git-read-only, restricted to
  its distinct concern and the compact package, and subject to the
  historical-supersession rule.
- Aggregate all three results before any finding disposition or closure.
  Performance/reliability remains N/A because neither predicate runtime body
  nor any adapter/server execution path changed.

## D-0096 Top-Level-Only Re-Review Result And Fix Assignment

- Documentation `019f669f-1e29-7203-b009-5d8d17057b61`, tool-enforced immutable
  Luna Medium: clean; TypeScript/API `019f669f-1ae8-7130-9794-57e7c3836328`,
  tool-enforced immutable Terra High: clean. Style/maintainability
  `019f669f-16a8-7283-8408-22e1ac904d93`, tool-enforced immutable Terra High:
  accepted P2 that the source TypeDoc says top-level but does not explicitly
  preserve the crucial no-routing-narrowing boundary. All are closed.
- The role runtime configuration is immutable and supplies the exact actual
  profiles; child-visible labels exposed only generic GPT-5 identity and no
  contrary profile. Resume implementer `019f65f6-4f41-7131-9dea-882113a53f9e`,
  expected original immutable Terra Medium, for one TypeDoc sentence plus
  durable evidence. No test or runtime behavior changes; re-review all three
  affected lanes afterward. Reliability remains N/A.

## D-0096 Source TypeDoc Correction Acceptance

- Expanded only the topic predicate TypeDoc to say it narrows top-level
  `topic.signalKind` and does not validate or narrow
  `topic.routing.signalKind`; signature and runtime body are unchanged.
- Coordinator independently passed both typechecks, transport root 10/10,
  focused source ESLint, exact four-path formatting, generated docs/API counts
  `100/28/205/19/20/6/3`, and Proto cleanliness. Implementer
  `019f65f6-4f41-7131-9dea-882113a53f9e`, actual immutable Terra Medium,
  remained childless and Git-read-only and is closed. Freeze for the final
  three-lane D-0096 re-review; reliability remains N/A.

## D-0096 Source TypeDoc Final Re-Review Assignment

- Baseline `9694fb86`; endpoint `cbe3bf53`; exact package
  `.superpowers/sdd/review-9694fb86..cbe3bf53.diff`; 1 commit; 13,283 bytes.
- Re-dispatch style/maintainability and TypeScript/API as explicit immutable
  Terra High and documentation as explicit immutable Luna Medium, all
  read-only, childless, Git-read-only, concern-scoped, and subject to the
  historical-text rule. Aggregate the wave. Reliability remains N/A.

## D-0096 Canonical Closure

- Final style `019f66a7-62df-7e51-b481-3eb1c791bf46`, tool-enforced immutable
  Terra High; documentation `019f66a7-5e4a-7ae1-b4b5-52bd8b68cbb3`,
  tool-enforced immutable Luna Medium; and TypeScript/API
  `019f66a7-661e-7750-9ffe-642a463d17b8`, tool-enforced immutable Terra High,
  are clean and closed. All remained read-only, childless, and Git-read-only.
- D-0096 is canonically clean. The two predicates have fixed paths; topic
  narrowing promises only top-level `topic.signalKind`; names/counts/shapes and
  all D-0093/D-0094 wire/risk decisions remain intact. Reliability retains its
  justified N/A. Proceed to the focused final T-0041 security review.

## Focused Final Security Preflight

- Source and regressions confirm Buf command/event encoding, one private
  8,388,608-byte per-frame cap owner, first-two request/publish and first-reply
  prefix consumption, generated-message reply rejection, and accepted SF-013.
- The active-status scan found one undated security-findings paragraph still
  saying D-0096 re-review was pending. Corrected that current sentence; dated
  historical pending entries remain chronology only. Generated/tracked output,
  diff integrity, and worktree status are clean. Freeze a replacement focused
  package from D-0093 human acceptance through this correction.

## Focused Final Security Review Assignment

- Baseline `4b3c30cd`; endpoint `a70a9d01`; exact package
  `.superpowers/sdd/review-4b3c30cd..a70a9d01.diff`; 38 commits; 340,257 bytes.
- Dispatch the existing final `security_reviewer` under explicit immutable
  Terra High, read-only, childless, Git-read-only, focused on D-0093 through
  D-0096 and current security artifacts. The reviewer must preserve the human's
  accepted SF-013 residual and assess whether implementation/docs honestly match
  it, not propose the declined native receive replacement.
- Reconfirm Buf-only Proto command/event wire, private reserved-kind/result V8,
  per-frame cap versus aggregate allocation, protocol-prefix trailer handling,
  generated-reply rejection, kind/envelope correlation, predicate non-validation,
  and no accidental trust/public-policy change. Historical superseded text is
  not active. Full task verification follows only after a clean security result.

## Focused Final Security Review Result

- Security reviewer `019f66ab-ff43-7951-9f7a-7052210d7ff9`, explicit and
  tool-enforced actual immutable Terra High: clean; childless, read-only,
  Git-read-only, and closed.
- Buf-only Proto command/event wire, reserved-kind/private-result V8, all three
  inbound per-frame caps, prefix-only consumption, generated-result rejection,
  runtime intake validation, public boundary, and current docs are accepted.
  Earlier SF-007 through SF-012 controls are not weakened. SF-013 remains the
  sole explicit accepted residual in this focused scope.
- Fresh native registry checks also pass: full/prod/dev audits report zero
  advisories at 235/7/189 dependencies, and all 235 registry signatures verify.
  Proceed to the full native T-0041 gate; no release blocker remains from review.

## Full Gate Cleanup-Lint Finding And Fix Assignment

- Native `pnpm --config.verify-deps-before-run=false verify` exited 1 during
  cleanup lint before tests: `spine-services.test.ts:5377` is 122 characters,
  exceeding the 120-character project limit. The line originated in earlier
  T-0041 commit `0d8135aa` and is part of this task's test scope.
- Resume implementer `019f65f6-4f41-7131-9dea-882113a53f9e`, expected immutable
  Terra Medium, sole writer/childless/Git-read-only. Reflow only that test
  declaration, update durable evidence, run focused lint/format/test and diff/
  scope scans. Then run one compact style review; docs, TypeScript/API,
  reliability, and security are N/A because semantics/contracts/runtime are
  unchanged. Restart the complete full gate afterward.

## Full-Gate Cleanup-Line Fix Implementation

- Reflowed only the 122-character `it(...)` declaration at the assigned server
  service test. Its exact test name, callback, assertions, and semantics are
  unchanged.
- Focused ESLint and `check-cleanup-rules.mjs` exit 0. Exact Vitest name
  selection passes 1 test with 148 skipped in the 149-test file. Formatting and
  final diff/status/generated/scope evidence are recorded in the work log.
- This mechanical fix is implementation-complete. Compact style re-review and
  the coordinator's restarted full gate remain pending; no other canonical lane
  is reopened.

## D-0096 Source TypeDoc P2 Implementation

- Expanded only `isTransportTopicKind()` source TypeDoc to preserve the
  accepted soundness boundary for maintainers: the predicate observes and
  narrows top-level `topic.signalKind`; it does not validate or narrow
  `topic.routing.signalKind`.
- No signature, test, README, decision, checker, matrix, adapter, server,
  runtime, wire, security-policy, or generated Proto source changed. The
  existing cast-free regression remains the behavior proof and passes 10/10.
- Both typechecks, focused source ESLint, generated API docs at exact counts
  `100/28/205/19/20/6/3`, and Proto cleanliness passed. Exact formatting and
  final scope evidence are recorded in the work log. This bounded P2 is
  implementation-complete; affected D-0096 re-review remains pending.

## Full Gate Cleanup-Line Coordinator Acceptance

- The exact unchanged test-name literal now has one short local name so
  Prettier preserves a compliant `it(...)` declaration; callback and assertions
  are untouched. Coordinator passed focused ESLint, cleanup enforcement, the
  exact named test at 1 passed / 148 skipped, exact formatting, and diff
  integrity.
- Implementer `019f65f6-4f41-7131-9dea-882113a53f9e`, actual immutable Terra
  Medium, remained childless and Git-read-only and is closed. Freeze this
  four-path correction for one style review; all other lanes retain N/A.

## Full Gate Cleanup-Line Style Review Assignment

- Baseline `feb7b764`; endpoint `1e47e351`; package
  `.superpowers/sdd/review-feb7b764..1e47e351.diff`; 1 commit; 13,556 bytes.
- Dispatch existing style/maintainability reviewer under explicit immutable
  Terra High, read-only, childless, Git-read-only, limited to the Prettier-stable
  name reflow and evidence. All other reviewer concerns retain N/A.

## Full Gate Cleanup-Line Style Review Result

- Style reviewer `019f66b8-fbaf-7a92-8138-930f2e5b7f57`, explicit/actual
  immutable Terra High: clean, childless, read-only, Git-read-only, and closed.
- The local name is well-scoped, exact text/callback/assertions are preserved,
  formatting is stable, and no unrelated churn exists. Restart full verify from
  the beginning; all other lanes remain closed/N/A.

## Full Gate Branch-Coverage Finding And Fix Assignment

- The restarted native full gate passed cleanup, formatting, and the complete
  73-file / 1,767-test suite. Coverage then failed only the global branch gate:
  statements `95.29%` (`9,539/10,010`), branches `89.81%` (`4,726/5,262`),
  functions `98.27%` (`2,452/2,495`), and lines `95.30%` (`9,356/9,817`). The
  90% branch threshold needs approximately ten additional observed branches.
  The gate stopped at coverage, so later docs/Proto stages did not run.
- Treat the coverage metric as the RED evidence. Add behavior-focused tests for
  existing T-0041 durable-subscription validation and ZeroMQ private reserved-
  kind/prefix handling; do not lower or exclude the threshold and do not change
  production behavior merely to satisfy instrumentation. Candidate uncovered
  branches include durable state expected-ID mismatch, cancel-state decoding,
  surrounding-whitespace rejection, query/subscription private V8 round trips,
  incomplete envelope handling, and route rejection.
- Resume implementer `019f65f6-4f41-7131-9dea-882113a53f9e`, expected original
  immutable Terra Medium, as sole writer, childless, and Git-state-read-only.
  Require focused tests and focused coverage evidence before coordinator
  acceptance; no full `verify` inside the fix context.
- Review style/maintainability and performance/reliability after the test-only
  batch. Documentation and TypeScript/API are N/A because no source docs,
  declarations, exports, or public contract should change. Security is N/A
  because the final security review is already clean and these tests only
  observe existing accepted behavior; any production security-boundary change
  would invalidate this N/A and require focused security re-review.
- Human decisions remain binding and unchanged: Buf serialization for Proto
  command/event signals; V8 only for private reserved kinds/results; an
  8,388,608-byte hard per-frame ceiling; first-two request/publish frames and
  first meaningful reply frame consumed with later frames ignored; and SF-013
  aggregate multipart allocation accepted for the initial release. The
  post-project ZeroMQ issue/workaround Internet research remains due after
  release closure and is not this coverage fix.

## Full Gate Branch-Coverage Test Batch Implementer Result

- Added test-only characterization for durable-state expected-ID mismatch,
  cancel-state fallthrough to invalid type URL, and surrounding-whitespace
  rejection, plus real ZeroMQ adapter/socket coverage for malformed private
  replies, query/subscription private V8 round trips, unexpected routes,
  incomplete envelopes, continuation, and later valid traffic. No production
  source or behavior changed.
- The coordinator's native full-gate result is the strict RED: 73 files / 1,767
  tests passed, then global branch coverage failed at `89.81%`
  (`4,726/5,262`) against 90%; statements were `95.29%`
  (`9,539/10,010`), functions `98.27%` (`2,452/2,495`), and lines `95.30%`
  (`9,356/9,817`). Characterization assertions were not fabricated to fail.
- GREEN coverage command
  `pnpm --config.verify-deps-before-run=false test:coverage:generated` exited 0
  with 73 files / 1,771 tests and exact totals: statements `95.38%`
  (`9,548/10,010`), branches `90.04%` (`4,738/5,262`), functions `98.27%`
  (`2,452/2,495`), and lines `95.39%` (`9,365/9,817`). This adds 12 observed
  branches and four tests, leaving two observed branches of threshold margin.
- Focused native validation passed both complete changed suites (server
  149/149; ZeroMQ transport 63/63) and the final exact five-test selection
  (5 passed / 207 skipped). Focused tooling typecheck, ESLint, exact formatting,
  diff integrity, generated visibility, and ownership scans are recorded in the
  work log. Full `verify` was deliberately reserved for the coordinator.
- Binding wire/security decisions remain unchanged: Buf for Proto
  command/event signals; private V8 only for reserved query/subscription/system
  kinds and private results; the 8,388,608-byte per-frame ceiling; first-two
  request/publish frames and first meaningful reply frame with trailers ignored;
  and accepted SF-013 aggregate multipart allocation. The batch is
  implementation-complete and awaits coordinator review/full-gate restart.

## Full Gate Branch-Coverage Coordinator Acceptance And Pre-Review Lint

- Coordinator-native rerun passed both complete changed suites together: 2
  files / 212 tests. Fresh tooling typecheck, focused ESLint, exact five-path
  formatting, and `git diff --check` also pass. Implementer
  `019f65f6-4f41-7131-9dea-882113a53f9e`, actual immutable Terra Medium,
  remained childless and Git-state-read-only and is closed.
- Diff inspection confirms exactly two test files plus three active records and
  no production source, declaration, export, generated output, public docs, or
  security artifact. Current status agrees that coverage is green at 90.04%
  with style/reliability review and full verification pending. Historical
  superseded pending text remains chronology only.
- The lightweight duplicate/public-leakage/docs-overclaim audit is clean: no
  production constant or policy changed, no internal type became public, and no
  documentation claim was added. D-0093/D-0094/D-0096 and SF-013 wording remain
  unchanged. Freeze the bounded batch for style/maintainability and performance/
  reliability review; documentation, TypeScript/API, and security retain their
  recorded N/A dispositions.

## Full Gate Branch-Coverage Review Assignment

- Frozen implementation commit `6771c71e`; baseline `9a3ce8f8`; exact package
  `.superpowers/sdd/review-9a3ce8f8..6771c71e.diff`; 1 commit; 33,468 bytes.
- Dispatch the existing style/maintainability and performance/reliability
  reviewers under explicit immutable Terra High. Both are read-only, childless,
  Git-read-only, bounded to this test-only package, and subject to the active-
  state-over-historical-text rule. Aggregate the complete two-lane wave before
  any finding disposition.
- Style reviews whether four tests and their helpers remain coherent and useful
  rather than coverage-only duplication. Reliability reviews bounded waits,
  real IPC cleanup/continuation, test determinism, behavior fidelity, and
  whether the two-observed-branch coverage margin is acceptable for this final
  gate. Documentation, TypeScript/API, and security remain N/A for the exact
  no-production/no-contract/no-docs package.

## Full Gate Branch-Coverage Review Result And Fix Assignment

- Style/maintainability reviewer `019f66d4-a211-7ee3-9d88-8fbc34723e23`,
  explicit/tool-enforced immutable Terra High, accepted Important finding: the
  query/subscription integration round trip proves symmetry but not the binding
  private V8 wire, because a coordinated encode/decode codec change could still
  pass. Add an exact raw emitted-frame comparison with `serialize(envelope)`
  for both kinds while retaining integration coverage.
- Performance/reliability reviewer `019f66d4-d433-76b2-981e-a89381d2b46f`,
  explicit/tool-enforced immutable Terra High, accepted P2: the malformed-reply
  test awaits `addressReady.promise` without the established local harness
  deadline, so a setup regression can wait until runner timeout before native
  socket cleanup. Wrap it with `withHarnessDeadline`.
- Both reviewers found no other concrete defect, remained read-only, childless,
  and Git-read-only, exposed no contradictory runtime profile, and are closed.
  Reliability accepts the two-branch coverage margin as sufficient for this
  package under the authoritative full-gate rerun.
- Resume the existing implementer under its original immutable Terra Medium as
  sole writer. Fix both findings in the ZeroMQ test plus active logs, run the
  focused ZeroMQ suite/coverage and quality checks, and do not change production
  behavior. Re-review both lanes against a compact correction package.

## Full Gate Branch-Coverage Review Fix Implementer Result

- Retained the query/subscription public publish/subscribe round trip and added
  an independent socket-access-boundary assertion for both private kinds. The
  new characterization compares each raw payload frame directly with Node V8
  `serialize(envelope)` and also pins its route frame; it does not invoke or
  expose a private codec helper.
- Wrapped the malformed-private-reply test's deferred request-address await in
  the established `withHarnessDeadline` helper with a one-second bound, so a
  setup regression enters the existing `finally` cleanup path before the test
  runner timeout.
- The accepted review findings are the behavior RED. The characterization test
  passed immediately against correct production behavior, as allowed for this
  test-only correction. A tooling RED exposed union inference in the first test
  draft; the existing explicit distributive `PublishTransportOperation` pattern
  corrected it without production changes.
- Final focused native tests passed 2/2 with 62 skipped; the complete native
  ZeroMQ file passed 64/64. GREEN
  `pnpm --config.verify-deps-before-run=false test:coverage:generated` passed 73
  files / 1,772 tests with statements `95.38%` (`9,548/10,010`), branches
  `90.04%` (`4,738/5,262`), functions `98.27%` (`2,452/2,495`), and lines
  `95.39%` (`9,365/9,817`). Full `verify` was not run.
- The correction changes only the assigned ZeroMQ test and three active
  records. Actual implementation metadata is immutable `gpt-5.6-terra` /
  `medium`; the role remained sole writer, childless, and Git-state-read-only.
  Production behavior and all Buf/private-V8, 8,388,608-byte frame-cap,
  prefix/trailer, and accepted SF-013 decisions remain unchanged. The bounded
  fix is implementation-complete; compact style/reliability re-review remains
  pending.
- Final `typecheck:tooling`, focused test ESLint, `proto:check-generated`, exact
  four-path Prettier, and `git diff --check` exit 0. Status lists exactly the
  assigned test and three records; staged, production, generated, and forbidden-
  scope scans are empty.

## Full Gate Branch-Coverage Review Fix Coordinator Acceptance

- Coordinator-native complete ZeroMQ verification passes 1 file / 64 tests.
  Fresh tooling typecheck, focused ESLint, exact four-path formatting, and diff
  integrity also pass. The exact code review confirms both private kinds compare
  the observed publisher payload frame with `serialize(operation.envelope)` and
  the deferred address uses the established one-second harness deadline.
- Implementer `019f65f6-4f41-7131-9dea-882113a53f9e`, actual immutable Terra
  Medium, remained childless and Git-state-read-only and is closed. Its fresh
  full coverage-stage evidence remains green at 90.04% branches across 73 files
  / 1,772 tests.
- Lightweight pre-review lint is clean: exactly one test plus three records,
  synchronized active status, no production/generated/public/docs/security
  change, no duplicated policy, API leakage, or future-policy claim, and no
  change to any human decision. Freeze for compact style and reliability
  re-review; all other lane N/A dispositions remain valid.

## Full Gate Branch-Coverage Fix Re-Review Assignment

- Correction commit `337ed380`; baseline `621bf2b2`; exact package
  `.superpowers/sdd/review-621bf2b2..337ed380.diff`; 1 commit; 21,154 bytes.
- Re-dispatch existing style/maintainability and performance/reliability under
  explicit immutable Terra High, read-only, childless, Git-read-only, and
  restricted to the two accepted findings and correction scope. Aggregate both
  before closure. Historical superseded text is not active.
- Style must establish independent V8-byte protection without brittle helper
  coupling or excess duplication. Reliability must establish the deadline,
  cleanup, continuation, and deterministic frame observation. Documentation,
  TypeScript/API, and security remain N/A for the test-only correction.

## Full Gate Branch-Coverage Fix Re-Review Result And Final Assignment

- Style/maintainability `019f66e3-0448-7b72-9c4c-9eacff8b49ce`, explicit and
  tool-enforced immutable Terra High: clean. It accepts exact V8 bytes for both
  private kinds, separate integration round trips, distributive operation
  typing, deadline style, and correction scope.
- Performance/reliability `019f66e3-251b-7801-9a20-fee4cc90d4cf`, explicit and
  tool-enforced immutable Terra High: accepted remaining P2. If address capture
  misses its deadline, the already-started request retains the default 2,000 ms
  timeout while fixture close is bounded at 275 ms; cleanup can therefore time
  out with the native request still running.
- Both reviewers remained read-only, childless, Git-read-only, exposed no
  contrary profile metadata, and are closed. The raw V8 assertion and normal
  malformed-reply continuation are accepted.
- Resume the existing Terra Medium implementer for one test-only correction:
  assign the malformed-reply fixture a request timeout below its address
  deadline/fixture-close bound and immediately observe the request rejection so
  the failure path cannot produce an unhandled promise. Preserve normal-path
  assertions and all production behavior. Re-review reliability; style reopens
  only if the correction changes structure beyond this bounded timeout handling.

## Full Gate Malformed-Reply Reliability P2 Implementer Result

- The malformed-reply fixture now uses a test-specific 250 ms request timeout,
  expressed as `closeDeadlineMs - unansweredRequestTimeoutMs`, below both the
  275 ms address deadline and 275 ms fixture-close bound. The started request
  receives an immediate rejection observer.
- Address capture now uses `closeDeadlineMs`; if it misses that bounded deadline,
  the catch path awaits the observed request outcome before rethrowing, so fixture
  cleanup cannot begin with the native request still pending. The normal path
  retains the exact malformed-reply rejection and later valid-request success.
- Focused RED with a direct 25 ms request timeout failed 1/1 with
  `Operation was not possible or timed out` because the request expired before
  the raw Reply bind/receive handshake. The final 250 ms ordering passed the
  focused native selection at 1 passed / 63 skipped and the complete native
  ZeroMQ file at 64/64.
- `typecheck:tooling`, focused ESLint, exact four-path formatting, and final
  diff/scope/generated scans pass. Coverage was not rerun because production
  branches are unchanged and the immediately preceding global run remains green
  at 90.04%; full `verify` was not run.
- Changed scope is the assigned ZeroMQ test and three active records only.
  Actual metadata is immutable `gpt-5.6-terra` / `medium`; the role remained
  sole writer, childless, and Git-state-read-only. The accepted V8-byte test and
  every production/wire/frame/allocation decision remain unchanged. This P2 is
  implementation-complete and awaits reliability re-review.

## Full Gate Malformed-Reply P2 Coordinator Acceptance

- Coordinator-native complete ZeroMQ rerun passes 64/64; fresh tooling
  typecheck, focused ESLint, exact four-path formatting, and diff integrity pass.
  Direct review confirms the 250 ms request timeout is 25 ms below both 275 ms
  bounds, rejection observation is attached immediately, and the address-failure
  catch awaits settlement before fixture cleanup.
- Implementer `019f65f6-4f41-7131-9dea-882113a53f9e`, actual immutable Terra
  Medium, remained childless and Git-state-read-only and is closed. No production
  or V8-byte assertion changed.
- Lightweight pre-review lint confirms one test plus three records, synchronized
  active status, no production/public/generated/docs/security/policy change,
  and no human-decision change. Freeze for reliability-only re-review; style is
  already clean and the other lanes retain N/A.

## Full Gate Malformed-Reply Final Re-Review Assignment

- Correction commit `c0bebd10`; baseline `4e8ca551`; exact package
  `.superpowers/sdd/review-4e8ca551..c0bebd10.diff`; 1 commit; 19,658 bytes.
- Re-dispatch only the existing performance/reliability reviewer under explicit
  immutable Terra High, read-only, childless, Git-read-only, and bounded to
  request/address/fixture deadline ordering, rejection observation, cleanup,
  and normal continuation. Historical superseded text is not active.
- Style is already clean and did not reopen; documentation, TypeScript/API, and
  security retain N/A because no production, contract, docs, or trust-boundary
  code changed.
