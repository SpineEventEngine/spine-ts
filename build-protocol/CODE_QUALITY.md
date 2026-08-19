# Code Quality and Tooling Rules

Navigation: [README](README.md) | Related: [Build Protocol](BUILD_PROTOCOL.md)

This document defines the standards that future implementation and review sub-agents must apply. It intentionally specifies criteria first; exact tooling choices are made during implementation after current library investigation.

## Simplicity Directive

Human review on `2026-07-01` found the current framework code too
over-engineered. Simplicity is now a hard quality gate:

- prefer the Spine JVM concept name when one exists;
- prefer a small class/object API over exported standalone functions;
- add helper functions only when they make the caller easier to understand, not
  when they merely relocate branching or state;
- delete invented concepts that do not map to current task needs or Spine JVM
  source;
- use simple errors/exceptions for programmer and configuration mistakes;
- use small result objects only for runtime signal outcomes such as public
  acknowledgements;
- do not create large `*Details` error hierarchies without a recorded,
  JVM-backed reason.

`bounded-context.ts` and names such as
`BoundedContextRepositorySnapshotErrorDetails` are recorded as negative
examples. Future code should be shorter, flatter in behavior, and closer to
the JVM meaning.

## Source And Test Layout

Each package defines a semantic folder layout. The general shape is
onion-like:

- package-root `src/` contains only a handful of top-level entry files;
- first-level folders group the main package semantics;
- second-level folders exist only when a semantic detail needs a separate layer;
- tests live under `packages/<package>/test/`;
- test folders mirror the corresponding `src/` folder structure;
- production test files must not be co-located under `src/`.

Generated Protobuf-ES output is not source. It must live under
`packages/<package>/generated/`, be ignored by Git, and be removed and
regenerated during builds.

`pnpm lint` runs the repository cleanup enforcement checker for generated-code
layout, package test placement, line length, semantic-name length, callback
naming, and flat package `src` growth. `pnpm verify` runs `pnpm lint` and
therefore includes those cleanup gates.

## Naming And Declarations

- Keep declaration order aligned with file intent: the primary declaration
  matching the file purpose comes first, followed by supporting types, classes,
  objects, and constants.
- Keep methods and constructors small. Target 35 lines including the
  declaration; split by semantic sub-step only when the result is clearer.
- Keep names short and explicit. Avoid `Utils`. Avoid repeating domain context
  already fixed by the file, class, package, or subsystem.
- Code names must have no more than four semantic components, counting each
  capitalized word boundary as a component. Prefer up to three components.
- Callback names must start with `on`; callback type names must start with
  `On`. The exact parameter name `callback` is allowed for intentionally
  generic callbacks.
- Keep line length at 120 characters maximum; prefer 100 when readable.
  Reflow naturally.
- For multi-line parameter lists, prefer one parameter per line when clearer.
- For Buf-generated Protobuf messages, use the generated API first. Prefer
  `.clone()` for copying and do not invent ad-hoc clone helpers.

## Generated Type Extensions

When behavior naturally belongs to one generated message instance, framework
code may extend the generated interface/prototype in regular `src` code. Place
the extension where the equivalent helper would live semantically. Do not add a
facade merely to hide generated imports.

## Tool Selection Criteria

Before choosing a library or dev dependency, the implementing sub-agent must:

- check current stable releases;
- check maintenance activity, issue health, security posture, and TypeScript support;
- prefer well-known, actively maintained libraries;
- prefer libraries with first-class ESM and Node LTS support;
- avoid bespoke implementation of common infrastructure until a library search is documented;
- record the decision and alternatives in [DECISION_LOG.md](DECISION_LOG.md).

Candidate areas to investigate:

- package manager and workspace tooling;
- TypeScript compiler version and module target;
- linting and formatting;
- test runner and coverage;
- mutation/property testing where useful;
- gRPC server/client library;
- native transport binding;
- structured logging;
- OpenTelemetry;
- TypeDoc/API docs;
- release/versioning tooling.

## TypeScript Standards

Implementation must use current TypeScript best practices:

- strict type checking;
- no implicit `any`;
- explicit public API types;
- ESM-first package design unless a documented compatibility reason says otherwise;
- simple errors for programmer/configuration failures and structured result
  types only for runtime outcomes where the caller must branch;
- no global mutable state except isolated registries with deterministic lifecycle;
- async APIs return `Promise` or async iterables;
- public APIs documented with TypeDoc comments;
- generic base classes and interfaces where they improve type safety.

## Testing and Coverage

Coverage target is at least 90%.

Coverage must include:

- unit tests for metadata, validation, routing, buses, storage, and decorators;
- integration tests for bounded context command/event/query/subscription flows;
- process-local integration message-channel tests;
- black-box tests for the to-do example;
- regression tests for every bug fix;
- compatibility tests for copied Spine Protobuf message shapes and type URLs.

Coverage exceptions require a documented decision and reviewer approval.

## Documentation Requirements

Every task must keep relevant documentation current. Update only the surfaces
affected by the task:

- architecture documentation when behavior or boundaries change;
- package README when public package behavior changes;
- TypeDoc comments for public APIs;
- user guide sections when end-user workflows change;
- ADR/decision log entries for architectural or tooling choices.

Both the framework and the to-do example must have separate `USER_GUIDE.md` files before they are considered usable.

### Authored API and Proto Documentation

Handwritten TSDoc in tracked TypeScript and JavaScript source, tests, and
tooling uses multi-line blocks: an opener line containing only `/**`, a blank
line before each block, and `@param name Description` without a hyphen. The
only opening exception is a block at byte zero; files must not start with a
blank line. Summaries explain behavior or domain meaning rather than using
placeholders or vague verbs such as `Owns` and `Consists`. Public production
and example declarations require semantic TSDoc coverage; tests and tooling
are subject to layout rules only. Generated, distribution, dependency, and
frozen sources are excluded.

Authored example Proto uses meaningful domain documentation with a blank line
between a field or declaration and its following documentation block. Its
package is `spine.examples.<domain>` and its type URL prefix is
`type.spine.examples.<domain>`, where `<domain>` is exactly `messageboard`, `projects`,
`orders`, or `todo`. Authored example paths, packages, and imports contain no
`v1` component. Manifest-declared frozen copied Proto sources remain exempt and
unchanged.

Every production package has a beginner-oriented `README.md` for people and a
sibling `REFERENCE.md` for agents. The README links to the reference and states
its audience; the reference records the current detailed contract, entrypoints,
guarantees, limits, and applicable lifecycle or error behavior without
implementation-history narrative.

Human READMEs teach in reader order: explain what the subject is and the
smallest useful start before architecture, source-backed behavior, tests,
limits, and deployment or image operations. Keep the `README.md` approachable
and move exhaustive contracts to its sibling `REFERENCE.md`.

## Review Standards

Every task records a disposition for these concerns, but invokes only the
existing reviewers relevant to changed behavior or changed public claims:

- code style/maintainability for non-mechanical production structure and
  maintainability;
- documentation for public prose, README, guide, TSDoc, and behavior claims;
- TypeScript/API docs for public exports, types, declarations, Protobuf
  contracts, and public-API snippets; and
- performance/reliability for runtime, persistence, concurrency, lifecycle,
  resource, cancellation, retry, and performance semantics.

An unaffected concern receives a concrete N/A reason. Mechanical rules are
proved by deterministic checks and do not require a reviewer. Reviewers return
all findings in one wave, ordered by the severity defined in
`BUILD_PROTOCOL.md`. P0/P1 findings block acceptance, accepted P2 findings must
be fixed, and P3 advice or unchanged baseline debt is recorded without
expanding the task. Corrections reopen only substantively affected lanes, with
at most two complete waves; record-only and mechanically proved corrections do
not trigger another specialist review.

Security review is a final project/release-readiness gate, or runs earlier only
when the human explicitly requests it.

## Final Security Gate

The final security review must check:

- unsafe deserialization or `Any` unpacking;
- validation bypasses;
- tenant isolation;
- command/query authorization extension points;
- local IPC trust boundaries;
- dependency vulnerabilities;
- logging of sensitive data;
- denial-of-service risks in regex validation, subscription fan-out, and broker queues.

## Performance Standards

Performance review must check:

- unnecessary serialization/deserialization;
- event fan-out cost;
- query index usage;
- broker backpressure;
- memory retention in subscriptions and registries;
- worker process startup and shutdown behavior;
- hot-path reflection or metadata lookup caching.

## Non-Duplication Rule

Code style and quality rules must be assembled into a single authoritative file during implementation. Sub-agents must not create overlapping rule files that duplicate or conflict with each other. This document is the seed for that later authoritative file.
