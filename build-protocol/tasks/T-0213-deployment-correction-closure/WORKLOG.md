# T-0213 work log

## 2026-08-19 — setup

- Created an isolated worktree from clean pushed
  `main@4c28e2223b89fb203709413400770944778c071c`.
- Frozen installation passed. Fresh Proto generation and generated TypeScript
  build passed; ten randomized generation-ID metadata byproducts were restored
  without retaining generated source changes.
- Release-smoke inventory identified the retained managed lifecycle,
  subscription, Delivery, external-event, Todo, Docker, and Compose proofs.

## 2026-08-19 — release-plumbing correction

- Owner: existing `implementer`, explicitly configured
  `gpt-5.6-terra` / `medium`. Runtime telemetry was unavailable; the immutable
  configured profile is the evidence. The owner used no subagents.
- RED: the package-metadata test failed because the release command still named
  the deleted broker cross-process test and invoked Vitest twice.
- GREEN: the release command now contains one global coverage invocation and no
  deleted-test path; the removal guard rejects retired broker/Todo paths and
  current references; Todo's unused transport dependency and obsolete local-
  multiprocess guidance are removed.
- Focused checks passed: package metadata 11/11, removal guard, frozen lockfile
  installation, and Todo startup/black-box 55/55.

## 2026-08-19 — human scope correction

- A proposed general retained-subscription capacity/security change and GKE
  rollout policy were identified as unrelated to the deployment correction and
  removed before commit.
- General dependency remediation, whole-project security review, broad threat-
  model work, and unrelated release-status cleanup are excluded.
- Continued on `codex/deployment-correction-closure` from the last
  correction-related checkpoint without rewriting the previously published
  over-scoped branch.

## 2026-08-19 — cheap preflight assignment

- Mechanical verification function explicitly configured
  `gpt-5.6-luna` / `low`; runtime telemetry is recorded if exposed, otherwise
  the immutable configured profile and limitation are evidence.
- Read-only scope: frozen dependency state, generated/tooling builds, affected
  release metadata/removal/Todo tests, lint/policy/documentation/format/diff
  gates, and exact failure classification. No edits or subagents.

## 2026-08-19 — cheap preflight and current documentation

- The configured mechanical function completed with no edits. Runtime
  telemetry was unavailable; the immutable `gpt-5.6-luna` / `low` dispatch is
  the recorded profile.
- Frozen installation, generated and tooling typechecks, 66 focused tests,
  removal/cleanup/TSDoc/copyright/logging checks, documentation, release
  readiness, formatting, and diff hygiene passed.
- Corrected only current release-plan claims made false by the deployment
  correction. The former local-IPC To-do packet remains as explicitly
  superseded history; active gates now require managed complete replicas,
  Coordinator forwarding, Delivery, and external-event acceptance.

## 2026-08-19 — correction-path acceptance

- Managed replica lifecycle passed 58/58.
- Coordinator, durable Gateway subscription bindings, dynamic subscription
  fan-out, and child activation passed 116/116.
- Real managed remote-Delivery readiness plus domestic and ThirdParty external
  events passed 4/4.
- A real To-do server accepted the documented smoke client and shut down
  cleanly.
- Fresh Message Board, Gateway, and Delivery images built successfully. Their
  image contract passed 5/5, one-node Compose passed 3/3, and the two-node
  distributed topology passed 4/4. All owned processes, containers, and
  networks were removed.

## 2026-08-19 — focused review wave assignment

- Assigned the four existing relevant concerns with explicit configured
  profiles in `REVIEW.md`: style/maintainability, TypeScript/API documentation,
  performance/reliability, and documentation completeness.
- Review scope is the deployment correction only. Security, dependencies,
  retained-subscription capacity, and GKE rollout policy remain excluded.

## 2026-08-19 — review correction batch

- The complete review wave found no runtime/API/resource defect. Accepted one
  bounded current-documentation/guard batch.
- Replaced stale active local-IPC completion requirements with managed replica,
  Coordinator, Delivery, and subscription acceptance.
- Marked retired capability rows and former export counts as historical;
  current inventory remains 247 server and 7 transport exports.
- The managed README now requires complete application assembly and links the
  real To-do entry. Architecture wording calls `SingleProcessServerRuntime` a
  lifecycle/queue capability.
- Strengthened the removal guard only for active deployment-requirement prose;
  explicitly historical records remain permitted.
- Guard, metadata 11/11, documentation audience/snippets/API, cleanup, TSDoc,
  format, and diff checks passed.

## 2026-08-19 — re-review residual

- Style and TypeScript/API-doc re-reviews passed.
- Documentation/reliability identified one record-only residual: the lower
  T-0042 package inventory, accepted exclusions, and taxonomy still looked
  current. Labeled those sections explicitly historical without altering the
  correction's verified current API inventory.
- Final affected documentation and reliability re-reviews passed. All four
  focused review concerns are clean with no remaining P0-P2 finding.

## 2026-08-19 — first canonical release run

- All deterministic gates passed. The global coverage run completed 4,267
  passing tests, 19 skips, and two direct removal-fallout failures.
- Corrected the docs meta-test so a package README without a TypeScript
  construction API is not required to invent a fence; every present fence
  remains compiled and required nonempty.
- Removed the external-consumer fixture's obsolete `node-addon-api` override.
  It had been supplied only transitively by the deleted ZeroMQ package and is
  unused by the packed current surface.
- Focused regression passed 14/14 with tooling typecheck, ESLint, formatting,
  and diff hygiene. These test-only deterministic corrections do not reopen
  specialist review.

## 2026-08-19 — second canonical release run

- Deterministic gates and the two prior regressions passed. The coverage run
  completed 4,268 passing tests and exposed one managed-drain fixture race:
  the test posted immediately after sending private drain IPC, before the
  parent had necessarily processed it, and could observe client cancellation.
- Added a private test-fixture `draining` acknowledgement emitted only after
  `managed.close()` synchronously begins drain. The assertion still requires
  the public command call to return `Unavailable` after that causal boundary.
- Exact assertion passed under coverage. The two-test real-process file passed
  three consecutive fresh runs. Tooling typecheck, scoped ESLint, formatting,
  and diff hygiene passed. No production code or public contract changed.
- Narrow performance/reliability re-review passed; it confirmed that the
  acknowledgement corrects fixture ordering without weakening the lifecycle
  acceptance.

## 2026-08-19 — final canonical release run

- `pnpm --config.verify-deps-before-run=false verify:release` passed.
- 264 test files and 4,269 tests passed; 4 files and 19 tests were skipped.
- Coverage passed: 93.89% statements, 90.35% branches, 93.74% functions, and
  95.04% lines.
- Node/Proto generation and lint, generated/tooling builds, repository ESLint,
  cleanup, TSDoc, copyright, formatting, docs/API/snippets/audience, generated
  currency, logging containment, and release readiness all passed.
