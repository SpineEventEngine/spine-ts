# T-0163: Event handler `@Where`

Status: Implementation in progress

## Objective

Add build-time validated `@Where` filtering for Event-consuming handlers, with
canonical field conversion and deterministic filtered/fallback selection.

## Classification

High-risk. This adds a public decorator, changes generated handler metadata,
and changes repository dispatch selection for subscribers, reactors, and
Event-to-command handlers.

## Baseline and isolation

- Baseline: `origin/main@e59095f1`.
- Branch: `task/T-0163-where`.
- Worktree: `.worktrees/T-0163-where`.
- Preserve unrelated worktrees and the dirty primary checkout; push only `origin`.

## Acceptance criteria

1. Export exactly `Where(options: WhereOptions): HandlerMethodDecorator`, where
   `WhereOptions` has readonly `eventField` and `equals` strings.
2. Permit one `@Where` only on Event-consuming `@Subscribe`, `@React`, and
   Event-to-command `@Command` methods. Reject every other decorator/form.
3. Analyze only exact statically declared string-literal keys; reject spreads,
   computed keys, variables, unknown keys, duplicates, and multiple `@Where`s.
4. Resolve Proto source-name paths through singular intermediate messages to a
   supported singular scalar, bytes, enum, or message terminal field.
5. Parse/canonicalize the literal once through the configured field stringifier;
   missing optional/intermediate values do not match.
6. For one Entity/Event pair, require one filter path, unique canonical values,
   and at most one unfiltered fallback. Matching filtered handlers take
   precedence; otherwise use the fallback; otherwise ignore the Event.
7. Preserve generated-registry validation, immutable snapshots, tenant paths,
   durable routing/replay semantics, and existing Event acceptance behavior.
8. Cover all three supported handler forms, excluded forms, nested/missing
   paths, precedence/fallback, conflicts, canonical duplicates, and invalid
   static declarations with focused RED/GREEN tests.

## Assignment

- Frozen plan: existing requirements splitter, explicit `gpt-5.6-sol` / high.
- Implementation: primary orchestrator acting as the bounded implementation
  owner under the existing implementer function, `gpt-5.6-terra` / medium; no
  implementation subagents are dispatched.
- Runtime model metadata is unavailable on this surface; configured profiles
  are the durable assignment evidence.

## Review and verification

Style, TypeScript/API, documentation/TSDoc, and performance/reliability reviews
are required. Security is N/A for this in-process declaration/selection slice;
the Wave final security review remains mandatory.
