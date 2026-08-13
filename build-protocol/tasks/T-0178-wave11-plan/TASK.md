# T-0178: Wave 11 Semantic Type Generation And Interface Routing Plan

Status: Planning in progress

## Objective

Freeze a reviewed, dependency-ordered Wave 11 plan for the fresh upstream
`spine/options.proto` contract that adds `ts_type` to `(is)` and
`(every_is)`. The plan must cover post-Buf TypeScript interface generation,
message/type conformance, same-module interface discovery and inheritance,
runtime interface tokens, interface-based Command/Event/state-update routing,
the To-Do demonstration, generated-file provenance comments, and the removal
of copyright headers from generated TypeScript files.

This task is planning-only. It must not change the frozen Proto contract,
generation runtime, routing runtime, generated output, To-Do domain, or
reader-facing product documentation.

## Classification

High-risk planning. Wave 11 changes a frozen serialized contract intake,
generated TypeScript interfaces, build ordering, public routing declarations,
runtime dispatch precedence, example domain behavior, and beginner-facing
documentation. Requirements splitting is mandatory before implementation.

## Baseline And Isolation

- Baseline: `origin/main@ab1a6deb`.
- Branch: `task/T-0178-wave11-plan`.
- Worktree: `.worktrees/T-0178-wave11-plan`.
- The dirty and stale primary checkout remains untouched.
- `pnpm install --frozen-lockfile` passed.
- The first `verify:task --no-tests` attempt correctly exposed absent ignored
  generated output in the fresh worktree. After canonical `pnpm proto:generate`,
  the clean baseline passed the selected task profile.

## Frozen Upstream Evidence

- Repository: `SpineEventEngine/base-libraries`.
- Pinned `master`: `51cb428771e5af8a944675fb8e26e9eb2c3d0dfe`.
- Canonical source:
  `base/src/main/proto/spine/options.proto`.
- SHA-256:
  `894468a9ee427d4805accae79ef83cbdf5aacb09e41193b4d5cc965b3ede0ad9`.
- Introducing commit:
  `680092af8b7d1a7a916946c58feb541d5c614034` (`Add ts_type property to
IsOption and EveryIsOption`).
- The upstream comments require a simple top-level TypeScript interface name,
  reject nested interfaces, require an existing interface for `(is)` and for
  `(every_is)` with `generate = false`, generate the named interface only for
  `(every_is)` with `generate = true`, and apply both options when both exist.
- The introducing commit deliberately leaves the generated TypeScript base
  shape unspecified. The interface/token representation is therefore a Spine
  TS implementation contract and must not be misrepresented as upstream JVM
  behavior.

## Human-Imposed Requirements Ledger

1. Wave 11 imports the fresh canonical `spine/options.proto` from
   `SpineEventEngine/base-libraries`, pins its exact upstream revision and
   checksum, and treats it as a new frozen Proto contract.
2. TypeScript ignores JVM-only fields in `(is)` and `(every_is)`. It uses only
   the upstream `ts_type` and `generate` semantics approved for TypeScript.
3. After Buf generates TypeScript, Spine TypeScript automatically performs a
   post-generation phase before atomically publishing the generated model.
4. When `(every_is).generate` is `true`, Spine generates the interface named
   by `(every_is).ts_type` and a same-named runtime routing token.
5. When `generate` is `false`, the named interface must already exist in the
   application's authored TypeScript source. `(is).ts_type` likewise names an
   existing authored interface; it does not generate one.
6. Authored interfaces are ordinary application code. They do not live in a
   special `interfaces/` directory. The generator discovers them in the same
   model module as the Proto declarations.
7. The direct `ts_type` interface and every interface in its `extends` chain
   must belong to that same model module. External types may still appear as
   property types; only inheritance parents are restricted to the module.
8. The generator rejects missing, ambiguous, re-export-laundered,
   non-interface, cyclic, generic-unbound, or module-escaping interface
   declarations. Symlink/path escape must fail closed.
9. Generated Proto message types carrying `(is)` or file-level `(every_is)`
   must be TypeScript-compatible with every declared interface, including
   inherited parents. TypeScript's compiler is the assignability authority.
10. Both `(is)` and `(every_is)` apply when both are present. File-level
    `(every_is)` also applies to eligible nested messages exactly as specified
    by the fresh upstream contract.
11. Generated interface artifacts live next to the Proto-to-TypeScript output,
    under the model module's generated tree (planned location:
    `generated/interfaces/`). No generated TypeScript belongs under a `proto/`
    source directory.
12. The same exported name denotes the TypeScript interface in type position
    and its runtime routing token in value position.
13. Existing routing declarations reuse `.route(...)`; do not restore the
    removed `routeSemantic()` invention and do not add `@Route` in Wave 11.
14. `.route(MessageSchema, callback)` continues to declare an exact-message
    route. `.route(GeneratedOrAuthoredInterfaceToken, callback)` declares an
    interface route without arbitrary string keys.
15. Routing precedence is exact message, then matching interface routes in
    explicit declaration/registration order, then the replacement/default
    route. Duplicate exact or interface-token declarations and invalid or
    incomplete tokens fail during construction. Do not add an automatic
    “most-specific interface” sorter.
16. Interface routing applies consistently to Commands, Events, and Entity
    state updates within each signal kind's existing cardinality contract.
17. Application routing is evaluated once per accepted admission. Durable
    replay uses the validated typed target stored in the Inbox and never
    invokes application routing again.
18. The To-Do example demonstrates Event interface routing. Commands are not
    marked with `(is)` or `(every_is)`.
19. The To-Do model gains a real `TaskListId`, uses it in `CreateTask` and Task
    state, and includes natural assignment commands/events rather than
    contrived Message Board behavior.
20. `task_events.proto` declares generated file-level `TaskEvent`. Existing
    and new Task events implement it. `TaskAssigned` and `TaskUnassigned` also
    implement the authored local `TaskAssignmentEvent` interface.
21. `TaskReassigned` does **not** have a dedicated
    `TaskReassignmentEvent` interface. Its two-target assignee routing is an
    exact `TaskReassigned` route. The redundant interface must not be added.
22. `TaskList` is keyed by `TaskListId` and uses the generated `TaskEvent`
    token to avoid one exact route per task event.
23. An assignee-oriented Projection is keyed by `UserId`. It uses an exact
    `TaskReassigned` route before the shared `TaskAssignmentEvent` interface
    route, demonstrating exact-over-interface precedence and zero/one/many
    Event targets.
24. Every generated TypeScript file has **no copyright header**. Generated
    files begin with a file-level block stating that Spine TypeScript generated
    the file, naming the stable original Proto import path, and warning that
    the file must not be edited manually.
25. Every generated interface, runtime token, and other generated declaration
    receives a concise TypeScript documentation/comment block identifying it
    as generated and referencing its original Proto source where applicable.
26. Generated source paths are stable module/Proto import paths, never absolute
    machine paths.
27. Copyright enforcement must exclude every generator-owned TypeScript file,
    reject a CodeMatters copyright header in generated output, and continue to
    require the approved header—with exactly one following blank line—on
    eligible authored TypeScript/TSX/Proto files.
28. The generated-file notice, source provenance, do-not-edit wording,
    copyright absence, and reproducibility are deterministic build/test gates.
29. Routing and `ts_type` documentation must be beginner-friendly and explain
    the Proto declaration, generated/authored interfaces, runtime tokens,
    inheritance, routing precedence, and replay behavior with the To-Do
    example.
30. Multi-Gateway work is deferred to Wave 12. Wave 11 must not modify or
    partially implement it.
31. Push only to configured `origin` during normal development. The prior
    one-time push to `SpineEventEngine/spine-ts:master` is complete and must not
    be repeated without a new explicit instruction.

## Selected Skills

- `using-git-worktrees`: isolates planning from the dirty primary checkout.
- `codebase-design`: keeps the generator and routing contracts deep, with one
  small public `.route(...)` interface and internal discovery/generation seams.
- `epic-breakdown-advisor`: splits the cross-cutting wave into vertical,
  review-sized increments rather than independent technical layers.

## Requirements-Splitter Assignment

- Existing role: `requirements_splitter`, acting as a senior TypeScript code
  generation, Protobuf contract, routing, and domain-modelling planner.
- Scope: read the complete ledger above, current build protocol/completion
  plan, current Proto generation and routing code/tests, the fresh upstream
  `options.proto` plus its documentation/history, relevant Spine JVM marker
  generation and routing code, current To-Do model/application, copyright
  checker/generator policy, and current reader documentation. Produce the
  smallest dependency-ordered Wave 11 task split with exact ownership,
  public/generated contracts, acceptance criteria, RED/GREEN evidence,
  verification profiles, coverage expectations, and relevant specialist
  review lanes. Identify genuine unresolved decisions, but do not reopen the
  human decisions frozen in this ledger.
- Expected model: `gpt-5.6-sol`.
- Expected reasoning: `high`.
- Dispatch: both fields must be explicit; read-only; no file edits; no
  subagents.

## Planned Verification Profile

This planning-only task will use deterministic plan/status/link checks and
`pnpm verify:task -- --no-tests` after requirements splitting and specialist
review converge. Wave implementation tasks will select bounded coverage-enabled
`verify:task` profiles or `verify:release` according to their shared build and
runtime impact.
