# T-0182: Authored Interface Discovery And Conformance

Status: In progress
Start: `2026-08-14 01:01 WEST`
End: Pending
Baseline commit: `8f987ae8`
Task log path: `build-protocol/tasks/T-0182-interface-discovery/TASK.md`
Branch: `task/T-0182-interface-discovery`
Worktree: `.worktrees/T-0182-interface-discovery`
Authoring sub-agent: existing `implementer`, explicit `gpt-5.6-terra` / medium
Reviewer sub-agents: Pending orchestrator dispatch
Implementation commit: Pending
Final branch HEAD: Pending

Task classification: High-risk
Classification reason: compiler-program discovery and conformance governs
generated public interfaces, staged publication rollback, and realpath-local
module boundaries.

## Objective

Resolve authored `(is).ts_type` and non-generated `(every_is).ts_type`
interfaces only from the same model module, prove every generated member is
compatible through that module's TypeScript Program, and return the resolved
declaration/local-parent analysis to the existing T-0181 writer without taking
over its generation or publication ownership.

## Required Inputs Read

- `AGENTS.md`, `build-protocol/BUILD_PROTOCOL.md`, and
  `build-protocol/PROJECT_COMPLETION_PLAN.md`.
- `build-protocol/planning/WAVE_11_TS_TYPE_ROUTING_PLAN.md` T-0182 section,
  `build-protocol/DECISION_LOG.md` D-0113, and T-0178/T-0181 records/code.
- `build-protocol/skills/EXPECTED_SKILLS.md` and the installed-skill lock.

## Skill Applicability

Skill sources checked: session inventory; task prompt; expected-skill manifest;
`find ~/.agents/skills -maxdepth 2 -type f -name SKILL.md -print`; and
`~/.agents/.skill-lock.json`. The installed skills and lock are reachable.

Selected skills read before governed work:

| Skill                            | Source                                                     | Applicability                     | Instructions applied                               |
| -------------------------------- | ---------------------------------------------------------- | --------------------------------- | -------------------------------------------------- |
| `implement`                      | `~/.agents/skills/implement/SKILL.md`                      | bounded implementation            | focused tests/typechecks and commit current branch |
| `tdd`                            | `~/.agents/skills/tdd/SKILL.md`                            | explicit RED/GREEN runtime work   | vertical behavior slices, one regression at a time |
| `typescript-advanced-types`      | `~/.agents/skills/typescript-advanced-types/SKILL.md`      | typed compiler/provider contracts | strict guards, readonly contracts, avoid `any`     |
| `verification-before-completion` | `~/.agents/skills/verification-before-completion/SKILL.md` | commits and completion claims     | fresh command evidence before claims               |

Skipped: `using-git-worktrees` is N/A because the explicit assigned isolated
worktree already exists; `requesting-code-review` is deferred because reviewer
dispatch remains orchestrator-owned. No selected skill overrides the build
protocol or human ledger.

## Human-Imposed Requirements Ledger

1. Resolve `(is).ts_type` and only non-generated `(every_is).ts_type` to a
   top-level authored interface in the same model module; generated file-level
   declarations remain T-0181 writer output.
2. Resolve the complete `extends` chain; every parent must realpath-local to
   that module. External property types remain allowed.
3. Use the model module TypeScript Program/tsconfig as the sole assignability
   authority. Return the authored declaration and local-parent analysis to the
   T-0181 writer; it alone writes, rewrites exports, and publishes.
4. Fail closed with stable diagnostics for missing, ambiguous, non-interface,
   nested, generic-unbound, cyclic, re-export-laundered external parent,
   symlink/path escape, incompatible, or incomplete declarations.
5. Exclude live generated root, actual stage/backup roots, dist/declaration
   output, and all realpath escapes. Staged generated output is compiler input
   only through the T-0181 source-view redirect.
6. Preserve prior publication on all diagnostics. Prove deterministic repeats;
   source additions/removals/renames, source edits during analysis, and
   recursively extended tsconfig changes must not publish mixed revisions.
7. Cover local inheritance, external property types, cumulative file/message
   options, nested messages, package-root fixtures, and packed consumers.
8. Do not implement T-0183 routing, To-Do expansion, `routeSemantic`, tags,
   `@Route`, authored special directories, or broad docs. Push each checkpoint
   only to `origin`; do not run `verify:release` in this task phase.

## Scope

In scope: proto-tools discovery/conformance/provider/diagnostics, provider
integration, compiler fixtures, external-consumer tests, and necessary writer
integration only.

Out of scope: T-0181 publication ownership, T-0183 routing, T-0184 To-Do,
T-0185 reader documentation, and Wave 12 behavior.

## Work Log

- `2026-08-14 01:01 WEST`: Records created before production edits. Existing
  implementer assignment is explicit Terra/medium; runtime model telemetry is
  unavailable, so the immutable configured profile is the evidence.

## Decisions

- D-0113 and the frozen T-0178 ledger are authoritative. No new architectural
  decision is introduced before a demonstrated blocker.
- Verification profile: coverage-enabled `verify:task` after convergence;
  `verify:release` remains reserved for the orchestrator/release boundary.

## Human Questions And Answers

- Blocking questions: none.
- Non-blocking questions: none.

## Files Changed

- Task/work/review records initially; production files pending TDD.

## Tests Run

- RED: `pnpm exec vitest run packages/proto-tools/test/authored-interface-provider.test.ts`
  failed because the discovery module did not exist.
- GREEN: the same focused test passes (1 file, 1 test), plus tooling typecheck,
  scoped ESLint, TSDoc, formatting, and diff integrity.
- GREEN integration: default post-Buf generation resolves both message `(is)`
  and non-generated file `(every_is)` declarations, emits writer-owned
  companions, and performs provider diagnostics before any `generateFile` call
  (2 files, 16 tests).

## Coverage Result

- Pending expanded behavior matrix; changed production files target at least
  90% branches.

## Documentation And Public API Impact

| Area                          | Impact                                                         |
| ----------------------------- | -------------------------------------------------------------- |
| Package README impact         | N/A in T-0182; T-0185 owns reader docs.                        |
| TypeDoc/API docs impact       | Internal provider/compiler modules; inspect if exports change. |
| Public API additions/removals | None intended.                                                 |
| Framework/example guides      | N/A; T-0185 owns guides.                                       |
| Compatibility notes           | Same-module authored-interface constraint is enforced.         |

## Security Impact

| Area                                     | Impact                                                       |
| ---------------------------------------- | ------------------------------------------------------------ |
| Dependencies/secrets/IPC/tenants/logging | N/A; no new boundary.                                        |
| Validation                               | High relevance: realpath/symlink/module escapes fail closed. |
| `Any`/deserialization                    | N/A.                                                         |

## Verification

- Focused RED/GREEN, compiler fixtures, typecheck, static gates, changed-file
  coverage, cheap preflight, then one coverage-enabled `verify:task`.

## Open Risks And Follow-Up Routing

| Risk/Follow-Up                       | Owner           | Disposition       | Next Review Point |
| ------------------------------------ | --------------- | ----------------- | ----------------- |
| T-0181 writer remains sole publisher | T-0181 contract | accepted boundary | integration tests |
| Routing/To-Do/docs                   | T-0183/4/5      | deferred          | later tasks       |

## Review Waves And Dispositions

- Pending. Style, documentation, TypeScript/API, and reliability are relevant;
  security is deferred to T-0186 absent a changed trust boundary.

## Integration Result

Pending.
