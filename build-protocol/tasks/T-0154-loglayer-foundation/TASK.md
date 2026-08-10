# T-0154: LogLayer Foundation

Status: Integrated; post-merge verified

## Objective

Establish the approved LogLayer dependency and public injection contracts,
private fault-contained emission utilities, explicit environment propagation,
and the checked containment-boundary manifest harness. Operational WARN and
ERROR call sites belong to T-0155, T-0156, and T-0156A.

## Classification

## Human-Imposed Requirements Ledger

- Use LogLayer directly; no Spine logger facade, global singleton, mutable
  static, or framework-owned logger lifecycle.
- Applications own logger configuration, flush, and close; runtime parts retain
  only an environment child.
- Operational call sites and product Markdown remain outside T-0154.
- Containment boundaries require stable adjacent IDs, a checked manifest, and
  behavior-focused evidence.

High-risk. This task changes shared dependencies and public server-side option
types, replaces the legacy warning callback, defines the authentication-secret
boundary for future logs, and adds shared build tooling used by later logging
slices.

## Baseline And Isolation

- Baseline: `origin/main@e30c2aa4`.
- Branch: `task/T-0154-loglayer-foundation`.
- Worktree: `.worktrees/T-0154-loglayer-foundation`.
- The dirty primary checkout and unrelated worktrees remain untouched.
- Push only to `origin`; never push the upstream remote.

## Acceptance Criteria

1. Use current stable `loglayer` directly. Do not add a Spine logger facade,
   global logger, mutable static, or lifecycle wrapper.
2. Replace `ServerEnvironmentSettings.warn` with `logger?: ILogLayer` and
   snapshot a child immediately. The caller retains flush/close ownership.
3. Add `logger?: ILogLayer` to exactly `DynamicUnaryOptions`,
   `SubscriptionGatewayOptions`, `DeliveryServerOptions`,
   `ScheduledNodeDiscoveryOptions`, `GkeNodeDiscoveryOptions`,
   `GceNodeDiscoveryOptions`, and both `GceRegistrarOptions` variants. Do not
   add it to the exclusions frozen in the Wave 9 plan.
4. Supply the exact default structured transport configuration and verify its
   JSON field names, severity mapping, and WARN/ERROR console stream behavior.
5. Add one private, fault-contained emission path. Synchronous throws and
   promise-like rejections from logging may not change business outcomes.
6. Positively allowlist the fixed fields, omit dynamic text over 256 UTF-8
   bytes, validate constant operation/reason codes and bounded counts, and
   admit no error objects/messages/stacks, payloads, headers, credentials, or
   session/authentication secrets.
7. Propagate the environment child explicitly through existing attachment and
   runtime construction options. Do not introduce a public framework logger
   type or a per-module fallback.
8. Add the TypeScript-AST containment checker, manifest, and fixtures frozen in
   the Wave 9 plan. Later tasks must be able to add manifest entries without
   changing its contract.
9. Begin every production behavior with an observed focused RED test. Reach at
   least 90% in every metric for changed production sources through scoped
   coverage.
10. Update public TSDoc and API declarations only. Product Markdown and README
    changes remain deferred to Wave 10.

## Correction Completion Evidence

- Review Wave One items 1-10 are corrected in `9bd4cfff` and `c1f2cdbb`.
- The environment logger child remains package-private, is forwarded to a
  replacement delivery generation by exact identity, and is never lifecycle-owned
  by the framework.
- The containment checker rejects every detectable unannotated suppression while
  accepting exactly one adjacent manifest binding; `verify:task` invokes it.
- Default structured-console WARN and ERROR records are behavior-tested for
  JSON fields, uppercase severity, and their console streams.
- Fresh scoped server coverage: 1,628 tests; statements 95.87% (1396/1456),
  branches 90.00% (612/680), functions 98.18% (325/331), and lines 96.10%
  (1356/1411).
- Targeted maintainability and performance/reliability re-reviews are clean;
  TypeScript/API documentation and documentation remain clean.
- Final `verify:task` passed 69 files and 1,629 tests with 95.87% statements
  (1396/1456), 90.01% branches (613/681), 98.18% functions (325/331), and
  96.10% lines (1357/1412).
- Merged into the `origin/main@e30c2aa4` integration line as `43f1eb9b`.
  The merge tree exactly matches the verified feature tree. Fresh post-merge
  generation/build, all five containment fixtures, the live checker, and four
  focused server files with 157 tests pass.

## Exclusions

- No operational WARN/ERROR call sites.
- No Google Cloud example composition.
- No browser logging or Sentry integration.
- No routing, `@Where`, implicit-ID, rejection, README, USER_GUIDE, copyright,
  or multiple-Gateway work.

## Dependency Evidence

- Official LogLayer and Google Cloud sources are frozen in the Wave 9 plan.
- The npm registry reports current stable `loglayer` as `9.4.0` on 2026-08-10.
- `StructuredTransport` is supplied by LogLayer itself; no invented transport
  package is permitted.
- Direct Google Cloud transport composition remains T-0166 behavior and does
  not create a Spine adapter.

## Skill Applicability

- Sources checked: the session skill catalog,
  `build-protocol/skills/EXPECTED_SKILLS.md`, the complete bounded
  `~/.agents/skills/*/SKILL.md` entrypoint list, and
  `~/.agents/.skill-lock.json`.
- Selected and fully read: `implement`, `test-driven-development`,
  `subagent-driven-development`, `using-git-worktrees`,
  `requesting-code-review`, and `verification-before-completion`.
- The repository task/work/review records replace the generic
  subagent-development skill's `.superpowers` scratch ledger, which the human
  explicitly prohibited.
- `systematic-debugging` was read for the preceding fresh-worktree integration
  failure; it is reused only if this task encounters an unexpected failure.
- `nodejs-backend-patterns` and `typescript-advanced-types` were considered but
  not selected because the frozen public contract and established repository
  patterns make this a bounded implementation task rather than a new backend
  architecture or advanced-type design exercise.

## Implementation Assignment

- Existing role: implementer acting as a senior TypeScript observability and
  server-runtime engineer.
- Ownership: the manifests and lockfile named by T-0154; server environment,
  private logging helpers, exports, environment attachment/runtime propagation,
  exact top-level logger option types, containment checker/manifest/fixtures,
  focused tests, TSDoc, and this task's work log.
- Expected model: `gpt-5.6-terra`.
- Expected reasoning: `medium`.
- Dispatch must set both fields explicitly. The implementer must not spawn a
  subagent, must preserve unrelated changes, and must push every commit to
  `origin` immediately.

## Review And Verification

- Required concerns: style/maintainability, TypeScript/API documentation,
  documentation/TSDoc, and performance/reliability.
- Security review is deferred to the final T-0167 gate; deterministic secret
  negative tests and scans are mandatory here.
- Run focused tests and scoped coverage during development, then cheap
  preflight, the complete specialist wave, one aggregated correction batch,
  affected re-reviews, and one final `verify:task` after convergence.
