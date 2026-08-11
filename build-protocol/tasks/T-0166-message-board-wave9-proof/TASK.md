# T-0166: Message Board Wave 9 proof

Status: Implementation in progress

## Objective

Prove the complete Wave 9 application contract through the Message Board
example without adding framework production behavior.

## Classification

High-risk integration task. The owned changes combine deployment logging,
generated handler metadata, routing, implicit validation, and rejection
behavior across one runnable example.

## Baseline and isolation

- Baseline: `origin/main@b05720a7`.
- Branch: `task/T-0166-message-board-wave9-proof`.
- Worktree: `.worktrees/T-0166-message-board-wave9-proof`.
- Preserve the dirty primary checkout and publish only to `origin`.

## Acceptance criteria

1. Compose an application-created `LogLayer` with the official Google Cloud
   Logging transport and a caller-supplied Google `Log`; prove it with a fake
   `Log` and without a Spine logging adapter.
2. Preserve the server's local structured default when no logger is supplied.
3. Demonstrate natural custom Event routing and an empty Event route in the
   Message Board model; framework-only route variants remain framework tests.
4. Demonstrate one natural `@Where` Event-field filter in an authored Message
   Board handler.
5. Remove redundant explicit `(required) = true` from the declaration-first
   Command and Entity ID fields and prove the implicit policy.
6. Retain the existing generated rejection throwable, Entity rollback, one
   typed rejection Event, and client-visible outcome.
7. Regenerate handlers from authored sources and prove generated outputs remain
   clean/untracked.
8. Change only Message Board manifests, deployment configuration, authored
   Proto/handlers, generator configuration, example tests, and protocol
   records.

## Assignment

- Frozen plan: existing requirements splitter, explicit `gpt-5.6-sol` / high.
- Implementation: primary orchestrator acting as the bounded implementation
  owner under the existing implementer function, explicit
  `gpt-5.6-terra` / medium; no implementation subagents.
- Runtime model metadata is unavailable; configured profiles are the durable
  assignment evidence.

## Review and verification

Style, TypeScript/API, documentation/TSDoc, and performance/reliability concerns
are required. Security uses deterministic secret-negative tests here; the final
Wave 9 security review remains mandatory under T-0167.
