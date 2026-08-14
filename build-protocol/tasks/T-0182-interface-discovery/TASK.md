# T-0182: Authored Interface Discovery And Conformance

Status: Specialist review complete; release verification pending
Start: `2026-08-14 01:01 WEST`
End: Pending
Baseline commit: `8f987ae8`
Task log path: `build-protocol/tasks/T-0182-interface-discovery/TASK.md`
Branch: `task/T-0182-interface-discovery`
Worktree: `.worktrees/T-0182-interface-discovery`
Authoring sub-agent: existing `implementer`, explicit `gpt-5.6-terra` / medium
Reviewer sub-agents: existing TypeScript/API, style/maintainability,
performance/reliability, and documentation reviewers; explicit configured
profiles recorded below
Implementation commits: correction convergence through `5127f3f3`
Final branch HEAD: Pending release closure

Latest checkpoint: the accepted specialist batch and its targeted-review
residuals are corrected. Named exports, tsconfig-owned discovery roots, the
complete same-module compiler input closure, staged generated import
redirection, immutable compiler input snapshots, prepublication revalidation,
diamond inheritance, canonical containment, and regular-file enforcement are
GREEN. Cheap preflight and the selected coverage profile pass; every targeted
specialist confirmation is CLEAN.

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

- Proto-tools authored-interface provider, interface generator integration,
  source-view transaction snapshot, bootstrap inventory, focused provider /
  generator / workflow tests, cleanup necessity inventory, and task records.

## Tests Run

- RED: `pnpm exec vitest run packages/proto-tools/test/authored-interface-provider.test.ts`
  failed because the discovery module did not exist.
- GREEN: the same focused test passes (1 file, 1 test), plus tooling typecheck,
  scoped ESLint, TSDoc, formatting, and diff integrity.
- GREEN integration: default post-Buf generation resolves both message `(is)`
  and non-generated file `(every_is)` declarations, emits writer-owned
  companions, and performs provider diagnostics before any `generateFile` call
  (2 files, 16 tests).
- GREEN inheritance: local parent interfaces are accepted; an imported external
  parent fails closed while external property types remain allowed (2 files,
  17 tests and focused static gates).
- GREEN correction convergence: provider, interface generator, source view,
  Proto-tools transaction, and real workflow suites pass 5 files / 208 tests.
  Source content/add/remove/rename, same-module transitive-import content, and
  recursive-config mutations preserve the exact prior tree and manifest.
  TypeScript candidates must be regular files; descriptor-based nonblocking
  reads reject a FIFO before capture and after a post-snapshot replacement.

## Coverage Result

- Final focused LCOV: 98.07% lines (356/363), 91.60% branches (240/262),
  and 98.66% functions (74/75) across the three changed production modules.
  The exact five-suite profile passes 208/208 tests; no threshold was waived.

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

- TypeScript/API (`gpt-5.6-terra` / high): three P1 findings accepted and
  corrected (named export, tsconfig authority, transaction revalidation).
- Style/maintainability (`gpt-5.6-terra` / high): diamond inheritance,
  parent-snapshot, containment-policy, and record findings corrected.
- Performance/reliability (`gpt-5.6-terra` / high): transaction inventory and
  live-to-staged compiler import redirect findings corrected.
- Documentation (`gpt-5.6-luna` / medium): source comments clean; stale record
  statuses/evidence corrected. Runtime telemetry was unavailable for every
  reviewer, so immutable configured profiles are the recorded evidence.
- Targeted re-review found a shared residual: same-module imports loaded
  transitively by TypeScript but omitted from explicit `files` roots were not
  frozen or eligible as local parents. Reliability also found that a FIFO with
  a TypeScript suffix could block inventory reads. Discovery roots remain
  tsconfig-owned, while the frozen compiler input closure now includes all
  eligible regular local TypeScript sources. A subsequent style confirmation
  identified the lstat-to-read FIFO replacement race; both independently
  executable source-view/provider boundaries now open nonblocking without
  following the final symlink, validate the opened descriptor as a regular
  file, and read that same descriptor. Reliability confirmation then found
  local declaration and `allowJs` inputs outside the digest. The source view
  now keeps authored declaration candidates separate from the complete local
  compiler inventory, which includes `.d.ts` plus JavaScript when enabled.
  A final reliability pass found and corrected the older provider check that
  rejected declarations even from compiler-only inputs; a real provider test
  resolves an authored interface through a local declaration helper. Final
  targeted confirmation is CLEAN.
- Security: N/A for T-0182 because it adds no dependency, secret, IPC, tenant,
  deserialization, or external capability boundary; Wave 11 final security is
  owned by T-0186.

## Integration Result

Not integrated. Targeted re-review, release verification, merge, tag, and
post-merge verification remain orchestrator-owned.
