# T-0080: Make authored APIs and examples concise and self-explanatory

## Status

In progress. T-0080A and T-0080B are complete; T-0080C is next.

## Classification

High-risk. This program changes public TypeScript contracts, authored example
Proto contracts, package coordinates, workspace layout, generated-code inputs,
documentation, and repository-wide enforcement.

## Objective

Make production packages and examples easy for people and coding agents to
understand by using short names, concise complete documentation, cohesive
objects or types, and an explicit example-family layout.

## Human-Imposed Requirements Ledger

- Every exported production and example declaration must have useful, concise
  TSDoc.
- Function and method summaries start with a third-person verb.
- Every parameter and non-void return value is documented.
- Type, interface, class, property, and constructor documentation explains the
  represented concept in simple terms.
- Every authored example Proto declaration and field is documented.
- Original Spine JVM Proto definitions and names remain unchanged.
- Standalone production and example functions are a last resort. Behavior
  belongs to a corresponding type or a clearly named and documented object
  unless a recorded exception explains why a function is necessary.
- TypeScript and authored example Proto names use at most four semantic
  components, ideally three, with shorter clear names preferred.
- Multi-module examples use a common parent and foundational `README.md`;
  single-module examples may remain flat.
- Chat moves under `examples/chat/` as one family containing its application,
  web client, Chat model, and Users model modules.
- Example packages are visibly distinct from production packages.
- Do not read, edit, stage, commit, move, delete, or use
  `human-review-1-jul.md`.
- Preserve `human-review-22-jul.md` as user-owned untracked material.
- Do not build Spine JVM.
- Push every commit immediately.

## Package And Layout Decision

npm scoped names have exactly one scope/name separator, so
`@spine-event-engine/examples/chat/model` is not a publishable package name.
Use this publishable convention:

- single-module example: `@spine-event-engine/example-<app>`;
- multi-module example: `@spine-event-engine/example-<app>-<module>`.

The Chat family becomes:

```text
examples/chat/
├── README.md
├── app/         @spine-event-engine/example-chat-app
├── model/       @spine-event-engine/example-chat-model
├── users-model/ @spine-event-engine/example-chat-users-model
└── web/         @spine-event-engine/example-chat-web
```

The Users model remains an independently packaged model dependency while its
physical placement makes the complete example discoverable from one entry
point.

## Behavior-Focused Acceptance Criteria

1. A deterministic check rejects undocumented exported authored declarations,
   public members, parameters, non-void returns, and constructor parameters.
2. The check rejects imperative function/method summaries that do not begin
   with a third-person verb and rejects empty or placeholder documentation.
3. Authored example Proto messages, enums, services, RPCs, enum values, and
   fields have concise comments; deterministic verification prevents
   regressions.
4. No authored TypeScript or example Proto name exceeds four semantic
   components unless a narrow recorded compatibility exception applies.
5. Every remaining standalone production/example function has a specific
   necessity disposition; other behavior is owned by a cohesive documented
   type or object without arbitrary utility dumping grounds.
6. Chat builds, generates, tests, and runs from the new family layout using the
   new package coordinates, including cross-model Proto imports and registry
   composition.
7. `examples/chat/README.md` introduces the whole application, its module
   boundaries, generation, server, browser client, authentication topology,
   commands, queries, subscriptions, tests, and known delivery limitations.
8. Existing single-module examples retain flat layouts and use the
   `@spine-event-engine/example-<app>` convention.
9. Generated output is regenerated only from authored sources and is not
   hand-edited.
10. All relevant focused, generated, package, docs, coverage, and repository
    verification gates pass; all canonical review concerns have durable
    dispositions.

## High-Risk Assumptions

- Breaking changes are allowed before the first real-world release; no
  deprecation cycle is required.
- `users-model` belongs to the Chat example family because Chat is its only
  example consumer, but it remains a separate npm model package.
- “Standalone function” means a function declaration not owned by a class or a
  named object. Exceptions are expected only where JavaScript/TypeScript
  semantics require a function identity or syntax and must be documented.
- Generated TypeScript and copied Spine JVM Proto sources are excluded from
  manual documentation and renaming.
- Tests may keep standalone helpers unless the helper is semantically part of
  a fixture or test type.
- A deterministic third-person-verb rule can use a version-controlled,
  fixture-tested grammar/lexicon while human review remains responsible for
  concision and factual quality.
- Exact partitioned debt records are a migration mechanism, not permanent
  exemptions. The final tree can reach zero TSDoc/name debt without weakening
  authored-source discovery.
- The Chat physical move can precede production public-name cleanup so all
  downstream reference repairs target final paths only once.
- Refactoring behavior into a cohesive owner is expected to preserve observable
  behavior. Any move that reveals a real domain/runtime semantic ambiguity is a
  blocker for that slice, not permission to redesign the runtime.

## Precise Authored Surface

- TypeScript enforcement covers tracked authored files under
  `packages/*/src/**` and `examples/**/src/**`, including `.ts`, `.tsx`, `.mts`,
  and `.cts` files.
- Generated, `dist`, dependency, fixture, and test output is excluded.
  Repository tooling under `scripts/**` is governed by its existing tooling
  standards, but it is not an end-user production/example API for this
  program.
- TSDoc enforcement applies to exported authored declarations, public class
  members, interface members, constructor parameters, function/method
  parameters, and non-void function/method results. Barrel re-exports do not
  require duplicate comments when the authored declaration is documented.
- TypeScript name enforcement covers authored declaration, member, parameter,
  binding, and enum-member names. It must not silently exempt examples,
  properties, signatures, destructuring bindings, or all-uppercase authored
  names.
- Standalone-function enforcement covers authored function declarations not
  owned by a class or named object. Inline callbacks and test helpers are not
  standalone production/example functions.
- Proto enforcement covers authored files below `examples/**/proto/**`.
  Generated output and copied original Spine JVM Proto files are excluded by
  source provenance, not by a permissive filename pattern.

## Enforcement Rollout Contract

The three enforcement slices land before remediation. Because the current tree
contains known debt, each checker may consume partitioned, exact debt records
keyed by rule, authored path, declaration kind, and stable declaration
identity. A debt record:

- freezes only an observed pre-T-0080 violation and cannot authorize a new
  violation or a second location;
- has a bounded owner and disposition;
- fails when stale, duplicated, malformed, or broadened;
- lives in an ownership partition that the corresponding remediation slice can
  update without editing one shared baseline file; and
- is removed when remediated.

T-0080O rejects residual TSDoc or name debt. Standalone functions may remain
only with exact, specific necessity dispositions; generic grandfathering,
directory-wide exemptions, and line-number-only exceptions are prohibited.
Narrow wire/JVM compatibility name exceptions must name the immutable source
contract and why renaming is unsafe.

## Dependency-Ordered Slices

| Slice   | Purpose                                                                                         | Depends on    | Write ownership                                                                |
| ------- | ----------------------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------ |
| T-0080A | Deterministic authored TypeScript TSDoc enforcement                                             | parent plan   | checker, checker tests, partitioned TSDoc debt records                         |
| T-0080B | Complete TypeScript-name and standalone-function enforcement                                    | A             | cleanup checker, checker tests, partitioned name/function records              |
| T-0080C | Authored example Proto comment and semantic-name enforcement                                    | B             | Proto checker integration, checker tests, partitioned Proto debt records       |
| T-0080I | Chat family physical/package migration and foundational README                                  | C             | workspace/root path consumers and all four Chat-family trees for the move only |
| T-0080D | Production foundations remediation                                                              | C, I          | `packages/{proto,core,storage,transport}` and their owned records/docs/tests   |
| T-0080E | Production storage/delivery adapter remediation                                                 | D             | `packages/{storage-datastore,storage-rdbms,delivery-server}`                   |
| T-0080F | Production server remediation                                                                   | D             | `packages/server`                                                              |
| T-0080G | Production auth and browser-client remediation                                                  | D             | `packages/{auth,client-web,client-react}`                                      |
| T-0080H | Remaining client, delivery-client, testing, and Proto tooling remediation                       | E, F, G       | `packages/{client-node,delivery-client,testing,proto-tools}`                   |
| T-0080J | Chat model and Users model remediation                                                          | D, H, I       | `examples/chat/{model,users-model}`                                            |
| T-0080K | Chat application and web-client remediation                                                     | F, G, H, J    | `examples/chat/{app,web}` and family README                                    |
| T-0080L | To-do example remediation                                                                       | H             | `examples/todo`                                                                |
| T-0080M | Project-management example remediation                                                          | H             | `examples/project-management`                                                  |
| T-0080N | Datastore-orders example remediation                                                            | E, H          | `examples/datastore-orders`                                                    |
| T-0080O | Cross-slice generation, checker-baseline closure, review reconciliation, and final verification | J, K, L, M, N | shared generation/API-doc expectations and parent records only                 |

Child briefs under `build-protocol/tasks/` define the detailed acceptance,
risks, exclusions, and review dispositions.

These child IDs are review-sized implementation slices of the single high-risk
T-0080 program. They merge in dependency order into the umbrella task branch;
they are not independently integrated into `main` or charged a redundant full
repository coverage gate. Each slice still receives focused verification,
durable review dispositions, an immutable endpoint, and remote synchronization
as directed by the orchestrator. T-0080O owns the program-wide full gate,
mainline integration, post-merge cadence, and durable closure.

## Future Slice Dispatch Gate

- One existing implementer owns each write slice with explicit
  `gpt-5.6-terra` and medium reasoning unless the protocol requires a
  correctness/public-contract escalation.
- Mechanical checks are orchestrator-dispatched functions using
  `gpt-5.6-luna` low reasoning, or medium for nontrivial classification.
- Documentation/version-specific verification uses `gpt-5.6-luna` medium.
- Relevant style/maintainability, TypeScript/API-doc, and
  performance/reliability reviewers use their existing configured
  `gpt-5.6-terra` high profiles.
- Every child task/work/review record must name the existing role/function,
  bounded scope, expected model, and expected reasoning before dispatch; both
  fields are explicit. It records actual runtime metadata when exposed or the
  immutable configured profile plus the self-introspection limitation.

## Parallel Write Boundaries

- A, B, and C are serial because they extend the same enforcement entry point.
- I runs after enforcement and before production remediation so later
  public-name consumer repairs target the final Chat paths, not paths that will
  immediately move.
- After D, E, F, and G may run concurrently only if D has stabilized public
  foundation names and each owner stays within its package set. Any discovered
  shared API-manifest or downstream-import edit is returned to the orchestrator
  for serialization rather than taken opportunistically.
- J follows I and D. K follows J and all production packages it consumes.
- L, M, and N may run concurrently after their production dependencies are
  stable. They must not edit shared root scripts, workspace files, or each
  other's example trees.
- O is the sole final owner of shared expected-export lists, root generation
  aggregation, stale-path removal, and program closure.

## Verification And Review Cadence

- Each slice runs focused checker fixtures, affected typechecks/tests,
  formatting, `git diff --check`, and docs/Proto/generated-clean checks relevant
  to its ownership.
- Mechanical findings return directly to the active implementation owner.
- Every slice records all four canonical concern dispositions. Documentation
  and TypeScript/API-doc review are relevant wherever TSDoc, exports, Proto, or
  README claims change. Style/maintainability is relevant when behavior moves
  from standalone functions into types/objects. Performance/reliability is N/A
  only when the slice changes no runtime, lifecycle, resource, persistence,
  concurrency, or performance behavior.
- Reviewers inspect immutable, review-sized slice endpoints. One complete
  relevant wave is collected before one correction batch; only substantively
  affected lanes reopen.
- Intermediate slices do not repeat the repository-wide coverage gate. T-0080O
  runs the one final `pnpm verify` after every reviewed slice is integrated and
  generation is clean. Post-merge full verification repeats only under the
  change-sensitive conditions in `BUILD_PROTOCOL.md`.

## Program Exclusions

- No new runtime feature, persistence behavior, concurrency policy,
  authentication topology, delivery guarantee, or deployment work.
- No renaming or rewriting of original copied Spine JVM Proto declarations.
- No handwritten edit to generated TypeScript or generated registries.
- No package publication and no Wave 5 or Wave 6 implementation.
- No test-helper cleanup unless a helper is part of production/example fixture
  semantics or blocks deterministic enforcement.
- No Spine JVM build or launch.

## Requirements-Splitting Assignment

- Existing role: requirements splitter.
- Scope: design bounded dependency-ordered tasks for enforcement, Chat layout
  and package migration, production TSDoc/structure/name remediation, example
  TSDoc/structure/name remediation, authored example Proto documentation and
  naming, generation, verification, and reviews. Minimize repeated full-suite
  runs and identify independently writable slices.
- Expected/configured model: `gpt-5.6-sol`.
- Expected/configured reasoning: high.
- Both fields must be explicit in dispatch.
- Runtime metadata must be recorded if exposed; otherwise record the immutable
  configured role/profile and the metadata limitation.

## Requirements-Splitting Runtime Evidence

- Existing role: requirements splitter.
- Immutable configured/dispatch profile: `gpt-5.6-sol` with high reasoning.
- The dispatch explicitly supplied both fields and referenced the durable
  assignment recorded at baseline `908d0c48`.
- The child surface does not expose self-introspection of the actual runtime
  model or reasoning setting. No visible mismatch or inherited-profile fallback
  was reported; final acceptance remains the orchestrator's assignment gate.
- The orchestrator accepted the A-O split after reviewing the parent plan,
  completion-plan change, work log, and every child brief. The dispatch used the
  required existing role and explicit profile, and no visible mismatch,
  fallback, scope violation, or unresolved planning finding remains.
