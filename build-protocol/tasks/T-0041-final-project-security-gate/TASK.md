# T-0041: Final Project Security Gate

Status: In progress - security artifacts assigned

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
- Investigation uses stable `TM-001` through `TM-012` hypotheses covering
  tenant identity binding/isolation, malformed schemas and `Any` payloads,
  exposed unbounded intake, subscriptions, delivery retries, local IPC,
  generated-module execution, supply chain, sensitive diagnostics, lifecycle
  cleanup, and regex/analysis work.
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
