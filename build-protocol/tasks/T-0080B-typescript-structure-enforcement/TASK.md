# T-0080B: Enforce TypeScript names and behavior ownership

## Status

Complete. Reviewed and mechanically verified on the T-0080 umbrella branch.

## Parent And Dependency

- Parent: T-0080.
- Depends on: T-0080A.
- Exit: T-0080C.

## Objective

Complete semantic-name coverage across authored production/example TypeScript
and require an exact necessity disposition for every standalone function that
remains after remediation.

## Classification

Standard. This extends shared deterministic tooling and the lint contract; it
does not itself restructure runtime code or change public APIs.

## Human-Imposed Requirements Ledger

- TypeScript names have at most four semantic components, ideally three.
- Standalone production/example functions are a last resort.
- Behavior belongs to a corresponding type or a clearly named documented
  object unless a recorded exception explains why a function is necessary.
- Avoid arbitrary utility objects and invented concepts.
- Existing callback-name, line-length, source-layout, generated-layout, and
  end-user API cleanup gates remain enforced.
- Tests may retain standalone helpers unless they represent production/example
  fixture behavior.
- No generated output is hand-edited; no Spine JVM build is run.

## Ownership

- TypeScript semantic-name and standalone-function checker logic/tests.
- Partitioned exact name exceptions and standalone necessity dispositions.
- No production/example remediation.

## Acceptance Criteria

1. Semantic-name coverage includes authored declarations, variables and
   destructuring bindings, parameters, class/interface/type members, methods,
   accessors, enum members, namespaces, and relevant import aliases under both
   package and example authored-source roots.
2. Component counting handles camel/Pascal case, acronym transitions, digits,
   and underscores consistently. All-uppercase authored names are checked
   rather than categorically treated as generated.
3. Generated bindings are excluded only by generated-source provenance.
4. Any copied-wire/JVM compatibility exception names its immutable source
   contract and exact authored occurrence; generic inherited allowlists fail.
5. Standalone discovery covers authored function declarations not owned by a
   class or named object, including nested declarations. Inline callbacks and
   test-only helpers remain outside this rule.
6. Each remaining function maps to one exact disposition with a specific
   JavaScript/TypeScript, callback identity, framework-boundary, or JVM-backed
   necessity. Generic “helper”, “legacy”, or directory-wide reasons fail.
7. The checker rejects stale, duplicate, relocated, broadened, and unmatched
   dispositions and rejects a necessity record for behavior already owned by a
   class/object.
8. Diagnostics are deterministic, safely escaped, path-confined, and stable
   across unrelated line changes.
9. Existing cleanup checks and their tests remain green.

## Exclusions

- No production/example refactor or rename.
- No requirement to turn unrelated test callbacks into objects.
- No Proto-name enforcement; T-0080C owns it.
- No public compatibility guarantee for pre-release authored TypeScript names.

## Verification And Review

- Focused cleanup-checker fixtures, existing cleanup-rule suite, lint invocation
  fixture, formatting, and `git diff --check`.
- Style/maintainability: relevant to the behavior-ownership rule.
- TypeScript/API docs: relevant to complete declaration/name coverage.
- Documentation: relevant to disposition semantics.
- Performance/reliability: N/A if traversal remains bounded and runtime code is
  untouched.

## Implementation Assignment

- Existing role: implementer.
- Ownership: TypeScript semantic-name and standalone-function checker
  logic/tests, exact partitioned name exceptions and function-necessity
  dispositions, lint integration, and T-0080B evidence only. No
  production/example remediation.
- Expected/configured model: `gpt-5.6-terra`.
- Expected/configured reasoning: medium.
- Both fields are explicit in dispatch.
- Implementation follows red-green-refactor. Each new enforcement behavior
  must be observed failing for the intended reason before its implementation.
- Runtime metadata is recorded when exposed; otherwise the immutable configured
  role/profile and self-introspection limitation are the acceptance evidence.

## Completion Evidence

- Completion implementer: existing implementer role, explicitly configured
  `gpt-5.6-terra` / medium. Runtime self-introspection is unavailable on this
  surface; no fallback or visible profile mismatch appeared.
- Added fixture coverage for exact immutable-baseline debt, semantic
  compatibility contracts, `.cts` import-equals aliases, generated-source
  provenance, exact necessity reasons, accurate diagnostics, stable identities,
  and unavailable production baseline failure.
- Mutation proof intentionally weakened exact baseline identity, concrete
  source-contract validation, and `.cts` discovery. The corresponding focused
  fixtures failed for their intended assertions; each implementation portion
  was restored before green verification.
- Regenerated exact ledgers after green focused tests: 95 semantic migration
  debt records and 1,672 standalone migration-debt records. Every generated
  record carries an explicit `migration-debt` disposition.
- Pre-final targeted-correction mechanical evidence: cleanup suite 104/104
  green; direct checker,
  tooling typecheck, scoped ESLint, pinned Prettier, and `git diff --check`
  green. Independent canonical `pnpm lint` completed successfully, including
  Proto verification/generation, generated build typecheck, repository ESLint,
  cleanup enforcement, and TSDoc enforcement.

## Final Acceptance Evidence

- Final cleanup-rule suite passes 105/105 after closing the operational
  baseline-override regression. Direct checker, tooling typecheck, scoped
  ESLint, pinned Prettier, `git diff --check`, and canonical `pnpm lint` pass.
- Exact ledgers contain 95 semantic-name and 1,672 standalone migration-debt
  records, all verified against immutable baseline `1ed40826...`.
- Style/maintainability, TypeScript/API documentation, and documentation
  concerns are CLEAN. Performance/reliability is N/A for bounded
  repository-only tooling with no runtime behavior.
- No Spine JVM build was invoked.
