# T-0175: Beginner User Guide

Status: Accepted review corrections verified; ready for orchestrator continuation

## Objective

Rewrite `docs/USER_GUIDE.md` completely as a slow, practical beginner journey
for building a Spine TS application, using Message Board as the continuous
example and linking dense contracts to their canonical references.

## Classification

High-risk documentation: the guide spans domain modelling, Proto conventions,
server behavior, clients, persistence, testing, observability, deployment, and
examples. It must teach without inventing or duplicating contracts.

## Human-Imposed Requirements Ledger

- Rewrite only the current reader-facing `docs/USER_GUIDE.md`; preserve
  historical records. T-0175 records are also in scope.
- Use the approved ten sections, in order: begin with the domain; create a
  project; describe the model in Proto; implement behavior; send Commands/read
  state; persist data; test; run/observe; package/deploy; continue from examples.
- Start slowly and assume little prior knowledge. Use short paragraphs, lists,
  tables, code, and small Mermaid diagrams instead of mechanical walls of text.
- Use Message Board as the continuous example. Use To-Do, Orders, Projects, and
  Distributed Message Board only where they teach a feature more clearly.
- Each section completes a useful step and ends with its one approved primary
  onward handoff. Additional symbol/example links must not create competing
  exhaustive targets.
- Teach current behavior only: exact `route()`/`replaceDefault()` routing, no
  semantic routing/`@Route`; `@Where({eventField, equals})`; implicit first-field
  Command/Entity IDs; rejection conventions; LogLayer logging; typed storage
  mappings and provider-native tenancy; durable delivery/replay; supported
  single-Gateway topology. Multiple-Gateway is deferred and Cloud Run is outside
  the initial offering.
- Preserve beginner-friendly natural prose and avoid needless “own” wording.
- Every TypeScript fence passes the strict default checker with real imports and
  declarations. All links resolve. Do not weaken shared gates.

## Assignment

Single implementation owner: existing `implementer`, explicitly configured
`gpt-5.6-terra` / medium. The owner uses no subagents, changes only the guide and
T-0175 records, preserves unrelated changes, and records runtime metadata if
exposed.

## Verification And Review

Run generated build, strict default snippets, API/audience, ten-section and
primary-handoff checks, retired-routing/current-scope/natural-prose scans,
links, format/copyright/diff, and `verify:task -- --no-tests`. Review
documentation, TypeScript/API documentation, and performance/reliability.
Style is N/A for prose-only changes; security is N/A unless the guide changes a
trust-boundary claim.

## Accepted Review Corrections

- Documentation P2: admit `docs/USER_GUIDE.md` to the default strict snippet
  inventory. An exact-list test must be red before registration and green after;
  both guide fences must compile through their real source contexts without
  stubs.
- TypeScript/API P2: section 8 must retain its approved server-reference
  handoff without claiming a nonexistent logging section or anchor. It may
  describe the reference as covering framework and server contracts.
- Performance/reliability is CLEAN. These corrections change no runtime
  behavior or delivery contract.
