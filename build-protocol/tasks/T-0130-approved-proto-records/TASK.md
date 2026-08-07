# T-0130: Approved Proto Records And Policy

Status: Complete

## Objective

Adds and freezes the approved deployment, Stand-subscription, and authenticated
Gateway-subscription records. Enforces the authored-Proto rules without
modifying frozen JVM sources.

## Classification

High-risk because serialized names, fields, options, and package exports become
framework contracts.

## Baseline And Ownership

- Baseline: `origin/main@dd06e75b`.
- Branch: `task/T-0130-approved-proto-records`.
- Worktree: `.worktrees/T-0130-approved-proto-records`.
- Production ownership: `packages/proto/proto/**`, curated Proto entrypoints,
  Proto manifests, and authored-Proto verification.
- Test ownership: Proto source, descriptor, entrypoint, and verifier tests.

## Acceptance

1. Adds the literal records and fields frozen by the Wave 8 plan.
2. Exports client, auth, and deployment schemas from curated subpaths while the
   existing generated compatibility subpath remains available.
3. Rejects `optional` and the approved comment-spacing violations in every
   Spine TS-owned Proto; frozen copied sources remain untouched.
4. Updates owned-source checksums and generated manifests deterministically.
5. Rejects obsolete names and paths in the new contract tests.

## Sequencing Correction

The reviewed plan originally required immediate deletion of the old private
Stand and deployment Protos. Their production consumers are owned by T-0137 and
T-0136 respectively, so deleting them here would make T-0130 impossible to
compile and integrate. They remain temporary private build scaffolding only;
T-0136 and T-0137 must delete them with their consumer migrations. This is not
a compatibility promise or alias, and T-0144 rejects either old file in the
completed Wave. The old deployment field is changed from `optional` to ordinary
proto3 presence now so the permanent policy has no exemption.

## Implementation Assignment

- Function: bounded Proto contract implementation owner.
- Expected profile: `gpt-5.6-terra` / `medium`.
- Surface limitation: the three available child slots remain occupied by
  completed immutable documentation-review threads from T-0129 and cannot be
  reclaimed by the current execution surface. The orchestrator therefore owns
  this bounded contract slice directly rather than silently dispatching a wrong
  role/profile. Review still requires the existing specialist concerns.
- RED-first: source contract and verifier tests fail before production sources
  and rules are added.
- No subagent spawning, JVM build, npm publication, migration remote, or unrelated
  consumer refactor.

## Review And Verification

- Style/maintainability: relevant to deterministic checker simplicity.
- Documentation: relevant to Proto comments and package discoverability.
- TypeScript/API docs: relevant to wire and export contracts.
- Performance/reliability: N/A; this slice adds no runtime persistence behavior.
- Use focused Proto tests and `verify:task`; push every commit immediately.

## Review Dispositions

- Style/maintainability: clean after one correction wave. Frozen copied-source
  descriptors are isolated from owned-source changes and the literal contract
  test is complete.
- Documentation: clean after the README and REFERENCE identified both old paths
  as unsupported temporary private scaffolding.
- TypeScript/API docs: clean after every runtime and TypeScript named-facet
  assertion resolves through the published package subpath.
- Performance/reliability: N/A because this task adds static/generated
  contracts and deterministic checks, not runtime persistence or lifecycle
  behavior.

No P0/P1/P2 remains. The full generated-coverage verification passed with
94.08% statements, 90.13% branches, 94.58% functions, and 95.10% lines.
