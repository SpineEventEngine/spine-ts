# T-0080A: Enforce authored TypeScript documentation

## Status

In progress.

## Parent And Dependency

- Parent: T-0080.
- Entry: accepted T-0080 plan.
- Exit: T-0080B.

## Objective

Add deterministic, source-aware enforcement for useful TSDoc on every exported
authored production/example declaration and public member, including complete
parameter and non-void result documentation.

## Classification

Standard. This changes shared quality tooling and the repository lint contract,
but not runtime behavior or a public package contract.

## Human-Imposed Requirements Ledger

- Every exported production and example declaration has useful, concise TSDoc.
- Function and method summaries start with a third-person verb.
- Every parameter and non-void result is documented.
- Type, interface, class, property, and constructor documentation explains the
  represented concept in simple terms.
- Generated output and copied Spine JVM Proto are not authored TypeScript.
- New enforcement must be deterministic and must not hide current debt behind
  broad exclusions.
- No generated output is hand-edited; no Spine JVM build is run.

## Ownership

- The authored-TSDoc checker and its focused fixture tests.
- Its root lint/docs integration.
- Partitioned, exact pre-existing TSDoc debt records.
- No production/example remediation.

## Acceptance Criteria

1. The checker discovers tracked `packages/*/src/**` and
   `examples/**/src/**` TypeScript/TSX variants recursively, including the
   future nested Chat layout, and excludes tests, generated output, `dist`, and
   dependencies by exact source rules.
2. It covers exported classes, interfaces, types, enums, functions, variables,
   namespaces, overload signatures, public/default-public class members,
   interface members, properties, constructors, methods, and accessors.
3. Re-export declarations do not require duplicated comments when the authored
   source declaration is documented.
4. It rejects absent, empty, placeholder, TODO-only, and mechanically repeated
   non-explanatory comments.
5. Function and method summaries must begin with a deterministically recognized
   third-person verb. The grammar/lexicon is version-controlled and fixture
   tested; reviewers, not arbitrary length thresholds, judge concision.
6. `@param` coverage matches every named/destructured parameter and constructor
   parameter without stale or duplicate tags.
7. `@returns` is required for non-void results and rejected when it lies about
   a void outcome. Async `Promise<void>` is treated as void; non-void async and
   iterable results remain documented.
8. Diagnostics are stable, path-confined, escaped, grouped by rule, and identify
   the declaration without relying only on a mutable line number.
9. Exact debt entries freeze only observed violations, reject new/broadened,
   duplicate, malformed, and stale entries, and are partitioned by future
   remediation ownership.
10. Focused checker tests cover overloads, interfaces, inheritance/overrides,
    constructors, accessors, arrow-export callables, Unicode/control paths,
    symlink confinement, and nested example packages.

## Exclusions

- No TypeDoc prose remediation.
- No name or standalone-function policy; T-0080B owns it.
- No Proto comment enforcement; T-0080C owns it.
- No dependency addition without the protocol's library investigation and
  decision record.

## Verification And Review

- Focused checker tests, lint invocation fixture, TypeScript tooling typecheck,
  formatting, and `git diff --check`.
- Documentation review: relevant for comment semantics claimed by the rule.
- TypeScript/API-doc review: relevant for declaration/parameter/result coverage.
- Style/maintainability: relevant for checker structure and diagnostics.
- Performance/reliability: N/A if the checker is bounded to tracked authored
  files with explicit traversal limits and no runtime code changes.

## Implementation Assignment

- Existing role: implementer.
- Ownership: authored-TSDoc checker, focused checker fixtures/tests, root
  lint/docs integration, exact partitioned TSDoc debt records, and this
  task's status/evidence. No production/example remediation.
- Expected/configured model: `gpt-5.6-terra`.
- Expected/configured reasoning: medium.
- Both fields are explicit in dispatch.
- Runtime metadata is recorded if exposed; otherwise the immutable configured
  role/profile and self-introspection limitation are the acceptance evidence.
