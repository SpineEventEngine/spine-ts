# T-0170: Foundations Documentation And Strict Snippet Gate

Status: Release-verified; integration pending

## Objective

Create the shared strict TypeScript documentation-snippet gate, then rewrite the
foundational Spine TS, core, Proto, server, testing, transport, and To-Do
reader journey so a beginner can move from a domain model to a running, tested
server application without reading exhaustive implementation prose first.

## Classification

High-risk shared documentation tooling plus broad reader-facing contract work.
The checker becomes a repository gate, and the documents describe public APIs,
server behavior, routing, validation, testing, and generated Proto use.

## Owned Reader Documents

`README.md`, `REFERENCE.md`, `packages/core/README.md`,
`packages/core/REFERENCE.md`, `packages/proto/README.md`,
`packages/proto/REFERENCE.md`, `packages/proto-tools/README.md`,
`packages/proto-tools/REFERENCE.md`, `packages/server/README.md`,
`packages/server/REFERENCE.md`, `packages/testing/README.md`,
`packages/testing/REFERENCE.md`, `packages/transport/README.md`,
`packages/transport/REFERENCE.md`, `packages/proto/proto/README.md`,
`examples/todo/README.md`, `examples/todo/REFERENCE.md`, and
`examples/todo/USER_GUIDE.md`.

## Acceptance Criteria

1. Add `pnpm docs:snippets:check` and one strict checker that enumerates every
   TypeScript fence in an explicit document list and type-checks it against real
   built package declarations/exports. Permissive `any` module stubs are
   forbidden.
2. The checker accepts a complete explicit path list for later Wave 10 tasks,
   reports sorted document/line diagnostics, fails on missing documents or
   unresolved snippet context, and is covered by meaningful fixture tests.
3. Wire the strict command into the appropriate shared documentation/generated
   gates without changing T-0169 copyright command or gate semantics.
4. Every owned document receives a recorded `changed` or
   `reviewed-no-change` disposition. Every TypeScript fence in all 18 owned
   documents passes the strict command.
5. README files remain concise introductions with their established visual
   style and one clear onward link. Dense contracts and limits belong in
   REFERENCE documents.
6. Teach one beginner-paced server path: identify a domain, declare Proto
   messages, generate TypeScript, implement Entity behavior/handlers, assemble
   a Bounded Context/server, send signals/read state, and test it.
7. Explain first-field implicit required IDs for Commands and Entity states,
   rejection conventions, exact/default Command/Event/state-update routing,
   event-field `@Where`, logging injection/use, validation, and durable replay
   accurately at the proper detail layer.
8. Do not claim TS routing consumes `(is).java_type` or `(every_is).java_type`,
   do not document `routeSemantic`, and do not advertise an `@Route` decorator.
9. Root/current-limit wording remains framework-level. Package-specific
   constraints move to or remain in package references.
10. Replace mechanical, dense, or AI-like prose with short paragraphs, lists,
    tables, and small diagrams where relationships need them. Avoid needless
    “own/owned/ownership” wording while retaining precise responsibility terms.
11. Links resolve locally and canonical explanations are not duplicated.
12. Do not edit `docs/USER_GUIDE.md`, browser/auth, storage/provider,
    delivery/deployment, Message Board, Orders, Projects, or other tasks'
    reader documents. Do not implement deferred runtime behavior.

## Ownership And Assignment

The single implementation owner controls the 18 documents above, the shared
TypeScript snippet checker and fixtures, its root package/gate wiring, and this
task's records. No other production writer may overlap these files.

- Existing role: `implementer`.
- Explicit expected model: `gpt-5.6-terra`.
- Explicit expected reasoning: `medium`.
- The owner must not spawn subagents and must preserve unrelated work.
- Runtime metadata is recorded if exposed; otherwise the immutable configured
  role/profile and surface limitation are evidence.

## Human-Imposed Requirements Ledger

- The scope is exactly the 18 listed reader documents, the shared snippet
  checker/tests, copyright-preserving root gate wiring, and T-0170 records.
  Do not edit deferred reader areas or implement deferred runtime behavior.
- README files remain concise, retain their established look and feel, and give
  one clear onward link. References keep dense contracts and limits; root limits
  remain framework-level.
- Reader prose must be beginner-paced and natural: use short paragraphs,
  lists, tables, or small diagrams instead of mechanical or dense prose.
- The strict checker enumerates explicit documents and compiles every TypeScript
  fence against real built declarations and exports. It has deterministic
  document/line diagnostics and no permissive `any` module stubs.
- Record a `changed` or `reviewed-no-change` disposition for every one of the 18
  reader documents, and require every TypeScript fence in that complete set to
  pass the strict checker.
- Missing documents and missing or invalid declared snippet contexts fail with
  deterministic path-and-line diagnostics.
- Verify locally resolving links and use one canonical explanation per topic;
  do not duplicate competing exhaustive contracts across the owned documents.
- The journey accurately covers first-field implicit required IDs, generated
  validation and rejections, exact/default command/event/state-update routing,
  event-field `@Where`, application logging, testing, and durable replay.
- TypeScript routing does not consume Java-only option metadata. Do not document
  semantic routing, `routeSemantic`, or an `@Route` decorator.
- T-0169 copyright command and gate semantics remain unchanged and enforced.
- Browser/auth, storage/provider, delivery/deployment, Message Board, Orders,
  Projects, root `docs/USER_GUIDE.md`, and deferred runtime behavior remain out
  of scope.

## Verification And Review

Use TDD for checker behavior. Run the strict checker across all 18 paths,
focused checker tests, link/audience/API/name/absence scans, generated build,
formatting, and cheap preflight before one review wave. Required concerns are
style/maintainability for shared checker policy, documentation for beginner
quality, TypeScript/API for snippets/contracts, and performance/reliability for
server behavior claims. Security is N/A unless the implementation changes a
security claim rather than linking its canonical source. After convergence run
`pnpm verify:release` once because shared documentation tooling changes.
