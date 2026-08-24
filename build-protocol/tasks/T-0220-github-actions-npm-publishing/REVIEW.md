# T-0220 Review Record

Status: Accepted on the feature-branch implementation endpoint

## Implementation Acceptance Gate

- Existing `implementer` role is assigned with explicit `gpt-5.6-terra` /
  `medium`, matching `TASK.md`. Child spawning is prohibited.
- Runtime self-telemetry may be unavailable; the Desktop surface's immutable
  role and explicit dispatch fields are the acceptance evidence.

## Required Concerns

| Concern                          | Planned existing role/function     | Bounded scope                                                                                                                 | Explicit model  | Explicit reasoning | Disposition                    |
| -------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------- | ------------------ | ------------------------------ |
| Style and maintainability        | `style_maintainability_reviewer`   | Permanent release module seams, workflow structure, errors, tests, and duplication                                            | `gpt-5.6-terra` | high               | Clean after affected re-review |
| Documentation completeness       | `documentation_reviewer`           | Maintainer rollout, OIDC setup, tag/version rules, resumption, and failure recovery                                           | `gpt-5.6-luna`  | medium             | Clean after affected re-review |
| TypeScript and API documentation | `typescript_api_docs_reviewer`     | Tooling module contracts, package metadata policy, and compatibility of reused artifact mechanisms                            | `gpt-5.6-terra` | high               | Clean after affected re-review |
| Performance and reliability      | `performance_reliability_reviewer` | Queueing, sequential dependency publication, registry polling, interruption/resumption, and cleanup                           | `gpt-5.6-terra` | high               | Clean after affected re-review |
| Security release readiness       | `security_reviewer`                | OIDC scope, environment binding, immutable Actions, provenance, credential absence, artifact integrity, and command injection | `gpt-5.6-terra` | high               | Clean after affected re-review |

All review dispatches prohibit child spawning. The orchestrator collects the
complete wave before returning one consolidated accepted correction batch.

## Mechanical Verification Assignment

| Existing role/function                          | Bounded scope                                                                                                                                                                                                                          | Explicit model | Explicit reasoning | Child spawning | Runtime metadata                                                                                                                       |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ------------------ | -------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Orchestrator-dispatched mechanical verification | Exact diff/history/inventory, release-policy/publisher/CLI/workflow/artifact tests, single-pack consumer proof, generated state, TypeScript/tooling, lint/format/docs/readiness, credential/provenance scan, and personal-origin state | `gpt-5.6-luna` | low                | Prohibited     | Desktop dispatch fields are explicit; immutable configured function/profile is acceptance evidence when self-telemetry is unavailable. |

The verification function is read-only and may not modify files, publish,
authenticate, or push. Its result is recorded before specialist review.

## Mechanical Correction

- `2026-08-24`: The assigned implementer corrected the sole mechanical
  `no-undef` finding in `scripts/release-artifacts.test.mjs`. Focused Vitest
  passed 12/12 and focused ESLint passed; specialist dispositions remain pending.

- `2026-08-24`: Accepted correction batch is partially resolved by focused
  release-suite evidence (39/39); specialist dispositions remain pending the
  orchestrator's complete review wave.

- `2026-08-24`: Cleanup-phase and dedicated-tag-endpoint follow-up evidence is
  40/40 focused tests with targeted lint/format/diff clean; specialist review
  dispositions remain pending.

- `2026-08-24`: Second re-review correction verified 41/41 focused release
  tests; final independent specialist dispositions remain orchestrator-owned.

- `2026-08-24`: Security re-review workflow assertion passed 3/3; the
  specialist security disposition remains orchestrator-owned.

- `2026-08-24`: Documentation re-review correction distinguishes safe transient
  same-commit resumption from persistent/ambiguous failures and prohibits reuse
  of an integrity/tag-mismatched version; documentation disposition remains
  orchestrator-owned.

- `2026-08-24`: Final accepted correction batch is covered by deterministic
  child-process context gating, owned-output cleanup, abort-aware registry
  timeout, selected/opposite tag-race, dedicated endpoint, and workflow
  allowlist/tokenized-command tests. Focused release evidence is 46/46 tests;
  ESLint, Prettier, and diff checks are clean. Remaining specialist dispositions
  remain orchestrator-owned.

- `2026-08-24`: Reliability correction preserves each preflight selected-tag
  value and requires exact equality on the immediate pre-mutation reread. The
  new deterministic release-version-to-absent race rejects before publish;
  publisher evidence is 21/21 with focused ESLint, Prettier, and diff checks
  clean.

- `2026-08-24`: Security correction replaces npm option parsing with a strict
  publish-job shell-command allowlist: the sole permitted npm invocation is the
  exact bundled npm 11.16.0 version check. Prefix, omit, and workspace install
  fixtures are rejected; focused workflow evidence is 4/4 with ESLint,
  Prettier, and diff checks clean.

- `2026-08-24`: Final workflow scanner correction removes shell/npm parsing.
  Tests deep-equal the complete ordered publish-job non-empty `run:` scripts
  and all workflow `uses:` references to reviewed allowlists. Extra commands,
  including `if npm`, `command npm`, and command substitution forms, fail by
  structure; focused workflow evidence is 4/4 with ESLint, Prettier, and diff
  checks clean.

- `2026-08-24`: Structural security correction deep-equals the complete ordered
  `jobs.publish.steps` objects, including `uses`, `with`, and `run` bodies.
  This rejects every unexpected step key; deterministic fixtures confirm custom
  shell, working-directory, and `env.PATH` additions fail. Job-level needs,
  environment, and permissions checks remain exact. Focused workflow evidence
  is 4/4 with ESLint, Prettier, and diff checks clean.

- `2026-08-24`: Final job-metadata correction replaces the partial publish-job
  matcher. Exact sorted keys, `needs`, runner, environment, permissions,
  concurrency, and full step objects are required. Fixtures prove extra
  `packages: write`, job `env`, `if`, and `container` fields are rejected.
  Focused workflow evidence is 5/5 with ESLint, Prettier, and diff checks
  clean.

## Final Acceptance

- Style/maintainability accepted the real-process CLI gate, non-returning signal
  behavior, single owned-output cleanup, and phase-specific failure coverage.
- Documentation accepted the protected-branch/environment setup, exact 18-
  package trusted-publisher inventory, transient resumption guidance, and
  mismatch/new-version recovery rule.
- TypeScript/API documentation accepted the corrected artifact declaration and
  found no new public package contract.
- Reliability accepted bounded registry reads, direct dist-tag parsing,
  dependency-first resumption, and pre-mutation/final selected and opposite tag
  invariants, including the selected-tag disappearance race.
- Final security accepted exact immutable Action pins, OIDC-only least
  privilege, exact Node/npm checks without privileged installation, and exact
  allowlisting of the complete publish job and all of its step objects.
- The mandatory cheap preflight and the single final `pnpm verify:release`
  passed. Official repository/environment configuration and actual NPM
  publication remain deliberate human activation steps.
