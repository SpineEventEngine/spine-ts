# T-0053: Frozen Protobuf And Descriptor Intake

Status: Complete, reviewed, and fully verified; integration pending

## Objective

Establish the authoritative Wave 1 client/delivery wire foundation from the
frozen JVM sources. Copy the exact transitive Proto closure, prove complete
normalized descriptor compatibility, replace the accidental generated-subpath
wildcard with three stable curated entrypoints, and migrate repository consumers
without exposing unsupported runtime APIs.

## Classification

High-risk. This task changes serialized contracts, generated source inputs,
package exports, build tooling, and imports used throughout the workspace.

## Frozen Sources

- `SpineEventEngine/core-java` commit
  `a408b0d70dafd603efc55b89c8b4b6f3e8c19d3b`, available read-only at
  `/private/tmp/t0052-frozen-jvm/core-java`.
- `SpineEventEngine/delivery-server` commit
  `21f2901f393e552208b97166f4eaeb942f9f5172`, available read-only at
  `/private/tmp/t0052-frozen-jvm/delivery-server`.
- `SpineEventEngine/time` merge commit
  `57d3dd98fea8efcdc4a3843f91143acc2dce87dc`, available read-only at
  `/private/tmp/t0053-spine-time`. Core JVM pins
  `io.spine:spine-time:2.0.0-SNAPSHOT.244`; its version-introducing commit is
  `91d52690603722a4fb2a49dc9a77b0e06e7a0d56`. This source supplies the
  transitive `spine/time_options.proto` dependency required by core delivery.
- The approved source and scope matrix is
  `build-protocol/planning/WAVE_1_JVM_PARITY_PLAN.md`.

## Ownership

- copied Proto source inventory and provenance manifest;
- `packages/proto` sources, tests, exports, and README/API claims;
- Proto copy/generation/verification scripts and deterministic fixtures;
- repository imports that must migrate from the generated wildcard;
- T-0053 task/work/review records and the Wave 1 active-frontier status.

Do not implement client behavior, entity state updates, environment changes,
query behavior, Delivery runtime, or delivery-server services in this task.

## Acceptance Criteria

1. Copy the exact Wave 1 client, core-delivery, and simple delivery-server
   transitive Proto closure from the frozen commits. Do not hand-edit upstream
   sources.
2. Record repository, commit, source path, SHA-256, and canonical URL for every
   copied file. Copy verification must fail deterministically on drift,
   omission, unexpected additions, or provenance mismatch.
3. Compare the complete deterministic normalized `FileDescriptorSet`,
   preserving:
   - file/package/import identity;
   - message, field, enum, service, and method names;
   - field numbers, scalar/message/enum wire types, labels, oneofs,
     `proto3_optional`, map-entry structure, packed/default/JSON-name semantics;
   - extension ranges, extensions, and custom options including type-URL
     options;
   - RPC input/output types and client/server streaming shape.
4. The only excluded descriptor field is `source_code_info`. Any additional
   exclusion is a blocker requiring a recorded compatibility argument.
5. Add mutation fixtures proving every compatibility-relevant category above
   changes the comparison result.
6. Replace `@spine-ts/proto`'s public `./generated/*` wildcard with exactly:
   - the existing curated package root;
   - `@spine-ts/proto/client`;
   - `@spine-ts/proto/delivery`;
   - `@spine-ts/proto/delivery-server`.
7. Migrate all repository consumers to supported entrypoints. Transitive-only
   contracts remain private unless a Wave 1 supported surface requires them.
8. Add positive package-resolution fixtures for every supported entrypoint and
   negative fixtures proving arbitrary generated paths and unsupported runtime
   contracts are not exports.
9. Existing client Proto files are exact frozen copies or are proven
   descriptor-equivalent with authoritative provenance.
10. Generation remains reproducible and generated outputs remain untracked.
11. Package README/API documentation accurately names supported entrypoints,
    provenance, descriptor guarantees, and deliberate runtime exclusions.

## TDD And Verification

- Write each drift, descriptor-mutation, and export-resolution test first and
  observe the expected failure before implementation.
- Focused gates include Proto source verification, generation, descriptor
  parity/mutation tests, package tests, build/typecheck, lint/format, API docs,
  generated-clean, release readiness, and diff hygiene.
- Final task gate is the full repository verification because copied sources,
  generated contracts, exports, and shared imports change.
- Native execution is required for the full suite's loopback and IPC tests.

## Review Concerns

- TypeScript/API: required for serialized compatibility and public exports.
- Documentation: required for provenance and package/API claims.
- Style/maintainability: required because generation/verification tooling and
  broad import migration are in scope.
- Performance/reliability: N/A if the final diff contains no runtime path;
  record the concrete disposition after implementation.
- Security: not a separate task lane; copied contracts and package exposure are
  reviewed in the relevant concerns. Final Wave 1 security review remains
  T-0067.

## Assignment Gate

- Existing role: `implementer`.
- Scope: this task only; one production/tooling writer; no child spawning.
- Expected model: `gpt-5.6-terra`.
- Expected reasoning: `medium`.
- Both fields must be explicit in dispatch.
- The implementer must not commit, push, merge, or modify unrelated files.
- Actual runtime metadata is recorded when exposed; otherwise the explicit
  dispatch and immutable configured role/profile are the accepted evidence.

## Baseline

- Branch/worktree: `task/T-0053-frozen-protobuf-intake` /
  `.worktrees/T-0053-frozen-protobuf-intake`.
- Base: `main` at `2bdbc903`.
- Locked install passed.
- Native baseline passed: 82 files / 1,901 tests, with 3 files / 21 tests
  intentionally skipped. No canceled-Connect cleanup error recurred.

## Review Correction Evidence

- End-user guide snippets and the executable Todo smoke module import Spine
  client contracts only through `@spine-ts/proto/client`; a regression scan
  rejects any future `@spine-ts/proto/generated/**` use in those consumers.
- Manifest verification derives exact canonical `sourceUrl` and `rawUrl`
  values from `repository`, `commit`, and `upstreamPath`. Repository and path
  mismatch fixtures fail before the correction and pass after it.
- `proto/README.md` identifies the short list as the original curated root
  subset, links the complete 39-source manifest, and explains the 48-file
  descriptor result.

## Completion Evidence

- The exact frozen intake contains 39 manifest-pinned sources and builds a
  normalized 48-file descriptor set with digest
  `e52be2d85355d13701055a4df3fed5eab8ad17ebe3bcc89482cc44b5cc02737f`.
- Public package exports are exactly the curated root, `client`, `delivery`,
  and `delivery-server`; arbitrary generated and runtime subpaths reject.
- TypeScript/API, documentation, and style/maintainability reviews are CLEAN
  after correction and focused re-review. Performance/reliability is N/A
  because the packet adds no production runtime execution path.
- Final `pnpm --config.verify-deps-before-run=false verify` passed 84 test
  files / 1,911 tests in both ordinary and coverage runs; 3 files / 21 tests
  were intentionally skipped. Coverage was 94.45% statements, 90.14% branches,
  94.71% functions, and 94.93% lines.
- TypeDoc/API, path-scoped Proto lint, generated cleanliness, release readiness,
  formatting, and diff hygiene passed. The earlier Connect cancellation did
  not recur in the accepted full run.

## Post-merge Correction Status

- The post-merge tracked-file gate reopened this task only for layout and line
  length: the three internal subpath entrypoints were moved into semantic
  directories and their private package-export targets updated. The public
  import contract remains exactly root, `client`, `delivery`, and
  `delivery-server`.
- Descriptor compatibility fixture coverage is preserved; the previously
  overlong mutation expressions are reflowed without changing categories or
  assertions.
- Captured RED is the post-merge cleanup failure plus the expected stale-dist
  entrypoint failure before rebuilding. GREEN: tracked cleanup; focused
  descriptor/entrypoint/metadata tests (3 files / 7 tests); generated
  typecheck; lint; format; and diff hygiene.
- This bounded correction still requires TypeScript/API and
  style/maintainability re-review and the orchestrator's final full gate.
  Documentation and performance/reliability are N/A because no end-user claim
  or runtime behavior changed.

## Post-merge Correction Acceptance

- TypeScript/API re-review is CLEAN: all four public package specifiers and
  symbol surfaces resolve, declarations build, and no stale source/dist target
  remains. Style/maintainability re-review is CLEAN: semantic directory depth,
  line-length compliance, mutation coverage, and tracked cleanup are accepted.
- Runtime self-introspection was unavailable for both reviewers. The explicit
  immutable profiles `typescript_api_docs_reviewer` / `gpt-5.6-terra` / `high`
  and `style_maintainability_reviewer` / `gpt-5.6-terra` / `high` are accepted
  with no visible fallback or mismatch.
- Final staged full verification passed 84 files / 1,911 tests in both ordinary
  and coverage runs, with 3 files / 21 tests intentionally skipped. Coverage,
  TypeDoc/API, tracked cleanup, scoped Proto lint, generated cleanliness,
  release readiness, formatting, and diff hygiene passed.
