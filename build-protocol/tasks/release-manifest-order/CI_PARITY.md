# Run publication checks before merge

## Request and scope

2026-10-02 continuation on `fix-release-manifest-order`, starting at
`faeea301a7469a23b6787454741e5760229e0e73`. Fresh fetch confirms official master
still at `230985421`. Keep the existing branch and snapshot.20 version commit.

The user requires regular PR CI to exercise all publishing procedures except
actual calls to publishing services such as npm and Sigstore. This includes
the saved artifact handoff and the local publication code, not merely building
packages. Do not claim that local tests prove remote service availability,
trusted-publisher configuration, or GitHub environment authorization.

## Human-Imposed Requirements Ledger

- PR CI must exercise all local publication procedures before merge.
- Replace real publication-service interactions only at their I/O boundaries;
  use the actual release policy, loading, ordering, reports and confirmation code.
- The trial and its regression tests must fail closed: ignoring an injected
  HTTP/process substitute must throw, not fall through to real fetch/npm.
- No real npm publication, registry publication-state requests, signing, OIDC,
  or Sigstore/Rekor service calls from the publication trial run.
- Existing CI dependency downloads, security audits and GitHub artifact transfer
  are retained. They are CI setup/checks, not the publication being simulated.
- Keep trusted publishing and provenance unchanged for real releases; no tokens,
  no third-party patches, no framework API changes, no speculative abstractions.
- Preserve npm config isolation, subprocess arguments/results, error handling,
  checksums, source commit, package inventory, dependency order and report checks.
- Trial reports must use a distinct directory and GitHub artifact name; they
  must never be consumed as evidence for real publication or its recovery.
- Simple documented code, focused regression tests first; three independent,
  sequential review/fix rounds for the final changeset, without memory/history.
- Push every commit immediately. Do not create a PR or rerun remote workflows.

## Proposed implementation

1. Put common preparation/check steps into a shared local GitHub workflow or
   action used by PR and publishing workflows. Use matching tool versions and
   frozen-install options; run audits before expensive verification.
2. Prepare persistent archives and transfer them to a fresh Node-only job in PR
   CI, matching the publishing job that has no workspace dependency install.
3. Run the actual release entrypoints on those archives using a small local test
   harness. Keep file loading, archive validation, source checks, npm arguments
   and isolated config, report writes/reads, and result handling real. Substitute
   only HTTP transport responses and the npm network-producing subprocess call.
   Never add an environment-controlled fake mode to normal production publishing.
4. Include the normal 19-package path, failure report, rerun/prior-report path,
   and read-only confirmation in local evidence. Existing focused tests continue
   to cover detailed negative cases and Rekor retry with a loopback test server.
5. Add regression tests for workflow parity and the no-network boundary. State
   exact coverage and unavoidable external limitations in the release runbook.
6. Run cheap checks, the independent reviews with fixes, then the release gate
   and fresh-job trial in PR CI for the pushed commit. Run the real archive
   trial locally first, without repeating the full suite locally. Keep the
   current version bump unless already used.

## Initial procedure comparison

| Procedure                                  | Previous PR CI          | Publishing       | Correction                |
| ------------------------------------------ | ----------------------- | ---------------- | ------------------------- |
| Frozen install                             | Scripts enabled         | Scripts disabled | Shared setup              |
| Audits and release verification            | Separate steps          | verify:publish   | Shared steps, audit first |
| Pinned Node/npm check                      | Present                 | Publish job      | Shared checks             |
| Archive preparation/consumer proof         | Temporary output        | Saved output     | Same saved output         |
| Artifact upload/download                   | Missing                 | Present          | Fresh PR consuming job    |
| Saved manifest/archive loading             | Present after first fix | Present          | Retain actual loader      |
| Publication orchestration/report lifecycle | Unit tests only         | Real CLI         | Full local trial          |
| Remote registry/provenance/npm calls       | Must not publish        | Real services    | Local boundary responses  |
| npm/Rekor failure compatibility            | Local fixture           | Real libraries   | Retain local fixture      |

## Classification and assignments

Standard bounded release-tooling extension. No change to stored release formats
or real publication policy is intended; escalate before changing those contracts.
The Desktop and bundled CLI support explicit child profiles. Native slots were
exhausted previously; CLI sessions may be used with memories/delegation disabled.

- Implementation: existing implementer, `gpt-6-sol` / `medium`, one writer for
  workflow/release script/tests/docs changes. Inspect existing transport seams
  before adding any. Report concrete gaps or unsafe assumptions before coding.
- Technical reviews: existing reliability and style reviewers, `gpt-6-sol` /
  `medium`, independent fresh sessions. Documentation: Luna/medium.
- Mechanical verification: orchestrator-dispatched Luna/low function.
- Main manages task records, accepts findings, commits and pushes. No child
  delegation. Runtime model metadata is recorded if exposed; explicit dispatch
  profiles are the evidence otherwise.

## Skills and verification

Use systematic debugging to map the gap, test-driven development for regression
proof, subagent-driven development for bounded implementation, requesting-code-
review for independent checks, and verification-before-completion for evidence.
The existing task skill inventory/expected manifest remains applicable.

Initial estimate 0.3–0.6 hours, subject to the full procedure comparison. Shared
release tooling requires `verify:release` after convergence, once. Existing
snapshot.20 checks/reviews are prior evidence, not acceptance of this extension.
