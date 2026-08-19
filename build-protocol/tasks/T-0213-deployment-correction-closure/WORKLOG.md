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
