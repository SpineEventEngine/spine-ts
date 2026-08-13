# T-0180: Freeze The Fresh Upstream Options Contract

Status: In implementation

## Classification And Isolation

- Classification: high-risk serialized-contract intake. `spine/options.proto`
  is a shared Protobuf wire contract and changes generated public descriptors.
- Baseline: `origin/main@ddb036c1`.
- Branch: `task/T-0180-frozen-options`.
- Worktree: `.worktrees/T-0180-frozen-options`.
- Selected expensive profile: one converged `pnpm verify:release`, because the
  frozen Proto source, descriptor lock, generated output, and package exports
  are shared build/release inputs.

## Human-Imposed Requirements Ledger

1. Ingest exact upstream bytes for `SpineEventEngine/base-libraries` master commit
   `51cb428771e5af8a944675fb8e26e9eb2c3d0dfe`, upstream path
   `base/src/main/proto/spine/options.proto`, whose SHA-256 is
   `894468a9ee427d4805accae79ef83cbdf5aacb09e41193b4d5cc965b3ede0ad9`.
2. Never reconstruct or hand-edit an equivalent frozen source; update its
   provenance manifest, checksum, and descriptor digest through the repository
   workflow.
3. Preserve existing Java-facing fields unchanged. Expose only
   `EveryIsOption.ts_type` as field 3 and `IsOption.ts_type` as field 2 for
   TypeScript generation.
4. Update the package Proto manifest, generated/curated root exports, and
   descriptor compatibility, provenance, and source-verification tests.
5. Preserve unknown-option compatibility and deterministic regeneration.
6. Keep the narrow Proto provenance documentation accurate; do not expand into
   reader-facing routing/interface guidance owned by later Wave 11 tasks.
7. Follow D-0113: `ts_type` is the TypeScript-only marker input; Java options
   remain intact; no semantic strings, `routeSemantic()`, `@Route`, or
   Wave-12 multi-Gateway work is introduced.
8. Use behavior-focused TDD: observe expected RED before production/runtime
   changes, then minimally turn it GREEN.
9. Preserve unrelated work, use no subagents, and push each checkpoint only to
   configured `origin` immediately.

## Acceptance Criteria

1. The frozen source matches the pinned raw upstream bytes and manifest digest.
2. Descriptor compatibility records the new normalized digest and proves field
   names/numbers plus unknown custom-option bytes remain compatibility-relevant.
3. Generated descriptors expose both `ts_type` fields while Java fields retain
   their existing numbers and types.
4. The package root keeps curated exports and exports the generated descriptors
   required to consume `(is).ts_type` and `(every_is).ts_type`.
5. Two generation runs are deterministic and source verification is clean.

## Skill Applicability

- Session inventory and `~/.agents/skills` were inspected; expected-skill
  manifest and installed lock were reachable.
- Selected: `test-driven-development` (mandatory test-first runtime contract
  work) and `verification-before-completion` (fresh evidence before commits or
  readiness claims). Both were fully read before governed action.
- `using-git-worktrees` is applicable in general but not selected: the
  orchestrator already created and assigned the required isolated worktree.
- `subagent-driven-development` is inapplicable because this sole owner is
  explicitly prohibited from spawning subagents.

## Implementation Assignment

- Existing role: `implementer`.
- Explicit expected profile: `gpt-5.6-terra` / medium.
- Dispatch: both fields explicit; sole bounded writer; runtime metadata is not
  exposed by this surface, so immutable configured role/profile is the evidence
  unless a visible mismatch occurs.
- Scope: this ledger and the T-0180 ownership listed in the approved Wave 11
  plan. Specialist review is orchestrator-owned and has not started.

## Planned Review Dispositions

- Documentation completeness: relevant to frozen-source/provenance claims.
- TypeScript/API documentation: relevant to public generated option fields and
  curated package exports.
- Style/maintainability: N/A pending implementation; the task should be a
  mechanical exact-source intake with no meaningful new production structure.
- Performance/reliability: N/A: no runtime algorithm, lifecycle, persistence,
  concurrency, or resource behavior changes; deterministic generation is
  mechanically verified.
- Security: N/A: no trust boundary changes; final Wave 11 security review is
  owned by T-0186.

## 2026-08-13 - Accepted Documentation Correction

The canonical Wave 11 authority is `SpineEventEngine/base-libraries`, not its
`SpineEventEngine/base` redirect alias. The provenance fixture now requires the
canonical repository and canonical source/raw URLs at the same pinned commit;
the exact source bytes, SHA-256, and frozen descriptor digest remain unchanged.

The first converged release attempt found only two cleanup line-length failures
in that fixture after its preceding generated descriptor, build, tooling, and
ESLint gates passed. The test now joins wrapped URL segments without changing
the asserted values; the orchestrator retains ownership of the next release
attempt and targeted documentation re-review.
