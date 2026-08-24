# T-0220: GitHub Actions NPM Publishing

Status: In progress
Start: `2026-08-24 Europe/Lisbon`
Baseline commit: `35e0d81dfd4fe72f93804319f7437de71279edda`
Branch: `codex/github-actions-npm-publishing`
Worktree: `.worktrees/github-actions-npm-publishing`
Authoring agent/function: existing `implementer` role
Configured dispatch: `gpt-5.6-terra` / `medium` (explicit)

Task classification: High-risk

This task introduces irreversible public-registry automation, OIDC
authorization, release serialization, artifact-integrity decisions, and
interruption recovery. It therefore uses behavior-first tests, the complete
relevant review wave, final security review, and one `verify:release` after
convergence.

## Objective

Publish the exact 18 public framework packages through NPM trusted publishing
after a merge reaches `SpineEventEngine/spine-ts` `master`, while pull requests
prove the release without receiving publication authority.

## Acceptance Criteria

1. `.github/workflows/build.yml` runs for pull requests targeting `master`, has
   read-only contents permission, runs the repository release gate and a
   non-mutating exact-artifact proof, and cannot publish.
2. `.github/workflows/publish.yml` runs only for pushes to `master`, serializes
   up to GitHub's maximum queue without cancellation, verifies and packs once,
   and gives OIDC authority only to a dependent GitHub-hosted publication job
   in `gh-actions-environment`.
3. Every external Action is pinned to an immutable reviewed SHA and checkout
   does not persist Git credentials.
4. The exact 26-manifest inventory is present, exactly 18 framework packages are
   public, all manifests share one version, and concrete internal pins align.
5. Exact `x.y.z-snapshot.N` versions select only `snapshot`; exact stable
   `x.y.z` versions select only `latest`; other prereleases fail before
   mutation. Public `publishConfig.tag` metadata agrees with the selection.
6. Preparation emits the exact tested tarballs and a deterministic integrity
   manifest, validates package payload/exports/license/dependencies, and proves
   the existing fresh external consumer path.
7. Publication is dependency-first and resumable: an explicit 404 is absent,
   identical integrity plus the selected tag is skippable, mismatches and
   ambiguous responses fail, and a fully published version fails.
8. The selected tag cannot move backward; the non-selected tag is unchanged;
   registry visibility is bounded and verified after every publication before
   dependents proceed.
9. No code path logs in, calls `whoami`, configures or reads an NPM token,
   disables provenance, mutates dist-tags separately, unpublishes, overwrites,
   changes versions, or invokes the disposable Wave 14 publisher.
10. Permanent maintainer documentation explains the feature-branch/PR/merge
    flow, OIDC trusted-publisher setup for all 18 packages, protected
    environment setup, version/tag rules, resumption, and failure handling.
11. Focused RED/GREEN evidence, deterministic checks, the complete relevant
    review wave, one consolidated correction batch, and one final
    `verify:release` converge without publishing a real package.

## Human-Imposed Requirements Ledger

- Use two workflows: PR verification and merge-triggered publication.
- Do not use Git tags as release triggers.
- Use OIDC only; introduce no NPM publication token.
- Publish after pushes to official `master`, which represent merged PRs.
- A fully published version fails; a valid partial version resumes.
- Snapshot versions use `snapshot`; stable versions use `latest`; unknown
  prereleases fail.
- Do not enforce implementing-agent commit-message rules in CI.
- Do not use the one-time publisher as the permanent mechanism.
- Never push to the SpineEventEngine organization without a separate explicit
  human request. Push feature commits only to configured personal `origin`.
- Use Standard speed and explicit repository model routing; no Max or Ultra.

## High-Risk Assumptions

- Public registry reads are unauthenticated and only an explicit 404 means a
  package version is absent.
- NPM trusted publishing requires a GitHub-hosted runner, Node 22.14.0+, npm
  11.5.1+, exact workflow filename `publish.yml`, and the environment claim.
- GitHub's fixed concurrency group with `queue: max` retains at most 100 pending
  runs; approaching that limit is an operator-visible release blocker.
- Exact tarball integrity and selected/non-selected tag state are part of one
  publication transaction even though NPM exposes no multi-package atomic
  operation.
- The official rollout separately configures all 18 NPM trusted publishers and
  the protected GitHub environment before the workflow is activated.

## Assignment Gate

| Existing role/function | Bounded ownership                                                                                                                 | Explicit model  | Explicit reasoning | Child spawning | Runtime metadata                                                                                                                   |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------- | ------------------ | -------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `implementer`          | TDD, permanent release modules, workflows, package policy, documentation, task records, focused verification, commits, and pushes | `gpt-5.6-terra` | medium             | Prohibited     | Desktop dispatch fields are explicit; immutable configured role/profile is acceptance evidence when self-telemetry is unavailable. |

## Verification And Review Plan

- Focused policy, artifact-manifest, fake-registry, interruption/resumption,
  tag, workflow-structure, documentation, and external-consumer tests.
- Mechanical typecheck, lint, format, workflow YAML, generated-clean, dry-pack,
  dependency, credential/provenance, and diff checks before review.
- Style/maintainability, documentation completeness, TypeScript/API,
  performance/reliability, and final security concerns. Artifact correctness is
  deterministic verification, not a new reviewer identity.
- One accepted correction batch and affected re-review only.
- Mandatory cheap preflight followed by one final `pnpm verify:release`.
