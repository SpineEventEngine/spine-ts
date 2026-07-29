# T-0080: Make authored APIs and examples concise and self-explanatory

## Status

Planning.

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
