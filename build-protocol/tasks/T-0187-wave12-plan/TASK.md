# T-0187: Wave 12 Runtime Correctness And Bounded Delivery Plan

Status: In progress — discovery and contract freezing

## Objective

Freeze a reviewed, dependency-ordered Wave 12 plan that closes `C-01`, `X-01`,
`D-01`, and the current-runtime portion of `P-04` with executable failing-before
proofs and truthful provider/runtime evidence. This task is planning-only. It
must not change browser, Gateway, query, storage, Inbox, delivery, provider, or
public runtime behavior.

## Classification

High-risk planning. The Wave crosses real browser streaming, Gateway/gRPC-Web
lifecycle, SQL query execution and cost, durable Inbox retention, shard
ownership and fencing, provider behavior, public configuration, documentation,
and release verification. Persistence, concurrency, lifecycle, public contract,
and multi-subsystem architecture triggers require one Sol High requirements
split before implementation.

## Baseline And Isolation

- Verified canonical baseline: `origin/main@7b8a631ecb33210e5da4da9ffa2d8eb8aa59d497`.
- Durable starting commit supplied by the human: the same exact SHA.
- Branch: `codex/wave-12-runtime-correctness-plan`.
- Worktree:
  `.worktrees/wave-12-runtime-correctness-plan`.
- The Desktop execution surface exposes the existing project roles and supports
  explicit child model and reasoning selection.
- The primary checkout is coordination-only, dirty, and 1,945 commits behind
  `origin/main`. Its tracked and untracked human state remains untouched.
- The protected untracked folder
  `agentic-review-of-main-branch-14-Aug-2026` is read-only evidence and must
  never be edited, renamed, deleted, formatted, staged, or committed.

## Scope

1. Trace and plan a real-browser sustained passive-viewer regression through
   the supported Gateway/gRPC-Web topology, isolating native subscription
   production from Gateway forwarding before assigning the defect.
2. Trace and plan production MySQL query-plan capability and parameterized SQL
   execution, with live-provider conformance and explicit unsupported-plan
   rejection.
3. Trace and plan finite delivered-Inbox retention under current shard
   ownership and fencing, separately from `keepUntil` deduplication.
4. Reconcile only Wave 12 documentation claims after runtime contracts
   stabilize.
5. Freeze review-sized implementation tasks and one final Wave convergence
   task.

## Exclusions

- No product implementation in T-0187.
- No Wave 13 cross-context event exchange or enrichment API.
- No Wave 14 package/SPI restructuring.
- No Wave 15 registry-integrity or tenant-admission feature.
- No Wave 16 Projection catch-up contract; `catchUpReadSide()` earns no credit.
- No Wave 17 distributed-security or dependency-remediation work.
- No Wave 18 JVM-runtime/coverage-evidence closure beyond Wave 12's honest
  provider/runtime evidence.
- No Wave 19 multiple-Gateway API or behavior.
- No Cloud Run work.
- No root README feature documentation unless it is genuinely repository-entry
  information.

## High-Risk Assumptions To Prove

1. The browser failure still reproduces on the exact current baseline and its
   owning lifecycle boundary is not assumed before native/Gateway isolation.
2. MySQL's current production plan method—not a test replacement—admits or
   rejects the reviewed plan shapes as reported.
3. Delivered Inbox rows remain durable indefinitely; `keepUntil` is a
   deduplication-protection deadline rather than a retention duration, and its
   absence or expiry can define cleanup eligibility without inventing another
   serialized field.
4. Existing shard leases, claims, version checks, and fencing supply the only
   legal cleanup ownership boundary unless code/JVM evidence proves a smaller
   compatible extension is required.
5. Pinned JVM evidence can resolve the finite default as immediate cleanup
   eligibility after deduplication protection ends and can resolve that no
   independent operator retention override is warranted; contrary repository
   evidence would make the choice a human blocker before implementation.

## Human-Imposed Requirements Ledger

1. Verify current `origin/main`; do not assume the supplied SHA is current.
2. Begin from the verified remote baseline in a dedicated branch and isolated
   worktree; the primary checkout is coordination-only.
3. Preserve every human-owned primary-checkout change and never mutate the
   protected agentic-review folder.
4. Read the complete named protocol, completion, remediation, handoff,
   specification, architecture, and relevant accepted decision records first.
5. Treat all 16 strict-review findings as true/open and only `S-04` as false.
6. Similar naming is not implementation.
7. Local or test-only behavior is not durable/distributed behavior.
8. V8 source inclusion is not provider-backed execution.
9. An intentional divergence remains a compatibility divergence.
10. `catchUpReadSide()` is not Projection catch-up and earns zero acceptance
    credit.
11. Preserve the binding Wave 12 through Wave 19 execution order.
12. Add no provisional cross-context, catch-up, multiple-Gateway, or Cloud Run
    API in Wave 12.
13. Use the existing `requirements_splitter` exactly once for the architecture
    and dependency split with explicit `gpt-5.6-sol` / high dispatch.
14. Record the splitter role, bounded scope, configured profile, and unavailable
    runtime telemetry before accepting its result.
15. Subagents must not spawn subagents.
16. Freeze the dependency plan and ledger before product implementation.
17. Ask the human only for a genuine unresolved contract choice that repository
    and pinned JVM evidence cannot answer and that materially changes behavior.
18. Reproduce `C-01` on current main before runtime changes.
19. Use a real browser through the supported Gateway/gRPC-Web topology.
20. Prove one passive viewer receives at least three sequential updates made by
    a different tab or actor; the viewer performs no writes.
21. Isolate native subscription production from Gateway forwarding before
    locating `C-01`.
22. Preserve best-effort notification semantics: real disconnect recovery may
    reconnect/re-query, but ordinary successive updates must not terminate a
    healthy stream.
23. Bound browser subscription cancellation, lifecycle, and resource cleanup.
24. Reproduce `X-01` without stubbing the production query-plan method.
25. Freeze a capability matrix for equality, comparison, composite filters,
    ordering, offset, and limit.
26. Use parameterized SQL pushdown for every admitted MySQL plan.
27. Preserve tenant and storage-group containment in every query.
28. Reject unsupported query plans explicitly; never silently fetch a whole
    group and filter in Node.
29. Provide shared provider-conformance cases, live MySQL execution, and
    Datastore participation wherever capabilities overlap.
30. Bound query cost and document index expectations.
31. Define finite default retention for successfully delivered Inbox rows and
    make any operator override a deliberate public configuration decision.
32. Define deduplication protection and retention eligibility separately.
33. Cleanup must be bounded/page-limited and delete only eligible delivered
    rows.
34. Preserve pending, claimed, retryable, and still-deduplicated rows.
35. Run cleanup only under current shard ownership and fencing; stale owners
    must not delete replacement-owner records.
36. Prove crash/restart, retry, duplicate, expiry-boundary, multi-node, and
    provider-conformance behavior with real persistence contracts.
37. Prove sustained successful delivery does not create monotonically growing
    storage.
38. Documentation changed by Wave 12 describes only implemented behavior and
    never advertises later-Wave capability.
39. Keep browser delivery, SQL execution, Inbox retention, documentation
    convergence, and final release closure as separate review-sized tasks unless
    evidence proves a shared boundary.
40. Every implementation task records functional acceptance, owned files,
    focused tests, changed-source coverage, live runtime/provider needs,
    documentation owner, specialist lanes, security disposition, and selected
    verification profile.
41. Every finding maps to implementation work and an executable acceptance
    test; no mock, stub, helper, or percentage substitutes for real runtime or
    provider proof.
42. Provider-bearing suites that share generation, emulator, database, port,
    or coverage resources run sequentially.
43. Changed executable lines and branches require at least 90% coverage; live
    provider evidence is recorded separately from V8 accounting.
44. The final convergence task owns combined cheap preflight, relevant
    specialist reviews, final security review, exactly one converged
    `pnpm verify:release`, integration, post-merge checks, and remote cleanup.
45. Push every feature-branch checkpoint immediately and never rewrite a
    published task branch without explicit human direction.
46. After task closure, reconcile every remote branch without losing unique
    work, delete completed branches and all tags, and prove `origin` exposes
    exactly `main` and no tags.
47. After this plan is reviewed, verified, merged, post-merge verified, and
    pushed, continue autonomously into the first approved implementation task
    unless a genuine protocol blocker or unresolved human contract choice
    prevents safe execution.

## Selected Skills And Applicability

- `using-git-worktrees`: selected and fully read; required for the human-mandated
  isolated worktree. Its isolation action is complete.
- `planning-with-files`: selected and fully read; this task uses durable
  `task_plan.md`, `findings.md`, and `progress.md` beside the canonical task
  records so discovery survives compaction.
- `architecture-decision-records`: selected and fully read; any Wave-wide
  public, persistence, configuration, or lifecycle decision will use the
  repository's existing `DECISION_LOG.md` format rather than a parallel ADR
  directory.
- `requesting-code-review`: relevant after the plan is mechanically clean; it
  will be read before reviewer dispatch.
- `verification-before-completion`: relevant before any completion claim; it
  will be read before final planning verification.
- `codebase-design`, `domain-modeling`, `api-design-principles`, and
  `nodejs-backend-patterns`: metadata reviewed but not selected. The existing
  high-risk splitter, Spine JVM guardrail, and repository protocol govern the
  bounded architecture/public-contract split without adding overlapping skill
  workflows.
- `subagent-driven-development` and implementation/TDD skills: not selected for
  this planning-only task. They become candidates only after T-0187 closes and
  an implementation task starts.

Inventory evidence: the session skill inventory, project
`build-protocol/skills/EXPECTED_SKILLS.md`, bounded enumeration of
`/Users/armiol/.agents/skills/*/SKILL.md`, and readable
`/Users/armiol/.agents/.skill-lock.json`. The first BSD `find -printf` inventory
attempt failed because macOS `find` lacks `-printf`; the portable `find | sed`
replacement succeeded. Project protocol and explicit human instructions govern
over all skill advice.

## Requirements-Splitter Assignment

- Existing role: `requirements_splitter`, acting as a senior TypeScript
  runtime, browser streaming, SQL provider, and durable-delivery architect.
- Bounded scope: inspect the complete Wave ledger, real current production
  code/tests/provider profiles/docs, and task-relevant pinned Spine JVM evidence;
  produce the smallest dependency-ordered Wave 12 implementation split and
  identify only genuine unresolved material contract choices. Read-only: no
  file edits and no subagents.
- Expected model: `gpt-5.6-sol`.
- Expected reasoning: `high`.
- Dispatch acceptance gate: both fields must be explicit. Desktop exposes no
  independently queryable runtime model/reasoning telemetry, so the immutable
  role configuration plus explicit dispatch are the available evidence unless
  a visible mismatch or fallback occurs.

## Planned Verification And Review

- Planning preflight: changed Markdown formatting, links/status/prohibited-claim
  scans, `git diff --check`, and deterministic documentation checks.
- Selected task profile: `pnpm verify:task -- --no-tests`, because T-0187 is
  planning/record-only and changes no runtime source, tests, contracts,
  dependencies, generated artifacts, or shared tooling.
- Relevant reviewer lanes: documentation completeness, TypeScript/API contract
  review, and performance/reliability. Style/maintainability receives a concrete
  N/A if the plan introduces no executable structure. Security is a final Wave
  convergence gate, not a per-planning-task reviewer; security-sensitive task
  boundaries and dispositions must nevertheless be frozen in the plan.
