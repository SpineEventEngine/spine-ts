# T-0081: Rename and explain the JVM compatibility tests

## Status

Accepted; ready for integration.

## Classification

Standard internal-tooling and documentation migration. The change moves a
directory used by automated test discovery and rewrites its contributor-facing
README, but it changes no production runtime, public package API, serialized
contract, or JVM behavior.

## Branch And Worktree

- Branch: `task/T-0081-jvm-compatibility-tests`
- Worktree:
  `.worktrees/T-0081-jvm-compatibility-tests`
- Baseline: `0f3e8b1ddbba97b1882d41affd6576b787212bb2`

## Objective

Rename `interop/jvm` to `compatibility-tests/jvm` so the directory is clearly
identified as repository test infrastructure, then explain in plain language
what the tests inspect, who runs them, when they run, what they prove, and what
they do not prove.

## Human-Imposed Requirements Ledger

- Use the directory name `compatibility-tests/jvm`.
- Move the complete existing JVM compatibility-test tree without changing its
  behavior.
- Update every active code, configuration, cache-ignore, command, and
  documentation reference affected by the move.
- Keep historical task evidence readable by updating path references without
  rewriting its substantive claims.
- Rewrite the moved README for normal contributors without internal slice IDs
  or unexplained project jargon.
- Explain that this is not an npm module or runtime dependency.
- Explain who runs the tests and that normal application developers do not use
  them.
- Explain source inspection, partial Proto comparison, the known six-file
  closure gap, and the absence of JVM build/runtime testing.
- Do not build, launch, or otherwise execute Spine JVM.
- Do not modify either human-review file.
- Push every commit immediately.

## Acceptance Criteria

1. The complete tracked tree exists under `compatibility-tests/jvm`; no tracked
   `interop/jvm` path remains.
2. Test discovery, ESLint scope, cache ignores, fixture paths, test assertions,
   and contributor commands use the new path.
3. `git grep interop/jvm` is empty for active and historical tracked material,
   except any explicit migration statement whose old path is necessary to
   explain the rename.
4. A named root command lets maintainers run the focused JVM compatibility
   tests without knowing Vitest discovery internals.
5. The README answers, in this order: what the directory is, who uses it, when
   it runs, what each check does, current result/limitations, how to run it,
   cache/network behavior, and what it does not prove.
6. The focused suite passes from the new path, Node syntax checks pass,
   formatting and diff integrity pass, and full verification passes because
   shared test discovery/tooling changes.
7. Documentation and style/maintainability review converge. TypeScript/API and
   performance/reliability receive concrete N/A dispositions unless the
   implementation changes their concerns.

## Skill Applicability

- Inventory sources: session skill inventory, bounded
  `find ~/.agents/skills -maxdepth 2 -type f -name SKILL.md`, the installed
  lock manifest, and `build-protocol/skills/EXPECTED_SKILLS.md`.
- Selected and fully read:
  - `using-git-worktrees` for isolated branch/worktree setup;
  - `implement` for bounded implementation and test execution;
  - `subagent-driven-development` for the required implementation owner and
    focused review handoff;
  - `requesting-code-review` for the pre-merge review gate;
  - `verification-before-completion` for fresh evidence before commit and
    completion claims.
- `doc-coauthoring` is not selected because the human supplied the structure
  and requested direct autonomous editing rather than an interactive
  co-authoring session.
- Architecture, API design, TDD, security, and backend-pattern skills are N/A:
  no architecture, public API, behavior, security boundary, or new
  infrastructure is introduced.
- Project protocol overrides any conflicting advisory skill instruction.

## Ownership And Dispatch

- Existing role: `implementer`.
- Scope: the directory move, path/configuration references, root focused-test
  command, README rewrite, historical path-only reconciliation, and focused
  tests.
- Expected/configured model: `gpt-5.6-terra`.
- Expected/configured reasoning: medium.
- Both fields must be explicit in the dispatch. Runtime metadata or its
  unavailability must be recorded before accepting the result.

## Implementation Summary

- Moved the complete tracked JVM compatibility-test tree to
  `compatibility-tests/jvm` and reconciled active and historical path-only
  references.
- Added `pnpm test:compatibility:jvm`, which checks the supported Node version,
  runs the fixture tests with Vitest, then runs the wire tests with Node's test
  runner.
- Rewrote the moved README for contributors; it explicitly limits the tooling
  to static source evidence and records the six missing imported Proto files.
- The configured implementation role/profile is immutable: `implementer`,
  `gpt-5.6-terra`, medium. Runtime self-metadata is unavailable on this
  execution surface.

## Review Plan

- Documentation: relevant; verifies plain-language completeness and factual
  limitations.
- Style/maintainability: relevant; verifies coherent naming, command placement,
  and absence of stale paths or unnecessary structure.
- TypeScript/API docs: N/A unless a public package or declaration changes.
- Performance/reliability: N/A unless runtime/resource semantics change.
- Security: N/A; no security boundary changes.
