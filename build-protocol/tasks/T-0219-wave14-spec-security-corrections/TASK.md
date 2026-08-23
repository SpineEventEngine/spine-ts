# T-0219: Wave 14 Specification And Security Corrections

Status: Ready for integration
Start: `2026-08-23 Europe/Lisbon`
Baseline commit: `ee8476f83ea76a108e2c0b9f5d5bb020cdb368f5`
Branch: `codex/T-0219-wave14-spec-security-corrections`
Worktree: `.worktrees/T-0219-wave14-spec-security-corrections`
Authoring agent/function: existing `implementer` role
Configured dispatch: `gpt-5.6-terra` / `medium` (explicit)

Task classification: High-risk

This correction changes release validation, generated-output reproducibility,
packed public artifacts, public API documentation coverage, and dependency
security. It therefore uses behavior-first tests, the relevant complete review
wave, and one final `verify:release` after convergence.

## Objective

Resolve every confirmed finding in the fresh Wave 14 review under
“Specification and correctness” and “Security”. The disposable publisher
wrapper and the separate standards-only task-record finding are outside this
correction.

## Scope And Acceptance Criteria

1. Re-running Proto generation in an unchanged checkout leaves every tracked
   generated marker and manifest byte-for-byte unchanged, and the generated
   cleanliness check detects real current-output drift.
2. Packed-artifact validation rejects every stale internal
   `2.0.0-snapshot.2` dependency reference in both manifests and archive text.
3. A fresh tarball consumer installs the exact artifacts, exercises
   `@spine-event-engine/server/browser` with authentication present, and keeps
   the native-server-without-auth proof.
4. TypeDoc and deterministic API validation cover the four published SPI
   subpaths for subscription lifecycle, backend membership, handler registry,
   and delivery.
5. The Datastore and RDBMS provider READMEs lead beginners through an
   executable snapshot installation and first factory success before
   contributor-only build instructions.
6. The GCE and GKE deployment READMEs present a meaningful Terraform first
   success before advanced topology and entrypoint detail.
7. The T-0218 record names the actual `BrowserBackend.baseUrls` contract.
8. Production dependency resolution contains neither vulnerable
   `brace-expansion@2.1.3` nor vulnerable `uuid@9.0.1`; lockfile policy and
   focused tests prevent regression.
9. Focused tests demonstrate RED/GREEN, the relevant review concerns converge,
   the mandatory cheap preflight passes, and one final `verify:release` passes.

## Human-Imposed Requirements Ledger

- Fix every fresh Wave 14 “Specification and correctness” and “Security”
  finding.
- Do not change the disposable publisher wrapper.
- Do not broaden this correction to the separate standards-only missing-record
  finding.
- Work autonomously under `AGENTS.md` and `BUILD_PROTOCOL.md`.
- Use Standard speed and explicit project model routing; do not use Max or
  Ultra.
- Preserve unrelated user changes in the primary checkout.
- Push every feature-branch commit to configured `origin` immediately.
- Do not publish, authenticate, or push to the official SpineEventEngine
  repository.

## Assignment Gate

| Existing role/function | Bounded ownership                                                                                                      | Explicit model  | Explicit reasoning | Child spawning | Runtime metadata                                                         |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------- | ------------------ | -------------- | ------------------------------------------------------------------------ |
| `implementer`          | Tests, implementation, dependency resolution, documentation, generated artifacts, and task records for this correction | `gpt-5.6-terra` | medium             | Prohibited     | Desktop dispatch fields are explicit; self-telemetry may be unavailable. |

## Verification And Review Plan

- RED/GREEN focused tests for generation stability, packed-artifact policy,
  tarball consumers, SPI documentation inventory, README ordering, and
  vulnerable dependency resolution.
- Deterministic generated-clean, package-artifact, documentation, API,
  dependency-policy, formatting, lint, typecheck, and diff checks.
- Documentation completeness, TypeScript/API, style/maintainability,
  performance/reliability, and final security review. Every canonical concern
  receives a recorded disposition.
- Mandatory cheap preflight followed by one converged `pnpm verify:release`.

## Initial Evidence

- The fresh review mechanically reproduced all accepted findings against the
  baseline commit.
- A fresh `verify:task` on that same baseline passed 57/57 selected tests and
  all shared gates. A later direct Vitest invocation without generated build
  prerequisites was diagnostic-only and is not a baseline failure.
- `pnpm audit --prod` identified high-severity `brace-expansion@2.1.3` through
  the production Datastore chain and moderate `uuid@9.0.1` through the Message
  Board logging chain.
- The security-best-practices skill has no generic Node dependency reference
  applicable to this pnpm release-policy correction; registry metadata,
  lockfile evidence, audit results, and project policy are authoritative here.
