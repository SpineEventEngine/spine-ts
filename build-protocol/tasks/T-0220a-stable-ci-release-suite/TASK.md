# T-0220a: Stable CI Release Suite

Status: Complete
Start: `2026-08-26 Europe/Lisbon`
Baseline commit: `22c6ea36498dc2d3df06f88d9234af6ac775e886`
Branch: `automated-publishing-and-packaging-improvements`
Worktree: `.worktrees/automated-publishing-and-packaging-improvements`
Authoring agent/function: existing `implementer` role
Configured dispatch: `gpt-5.6-terra` / `medium` (explicit)

Task classification: Standard

This correction changes shared test selection and repairs timing-sensitive test
behavior without changing production APIs, persistence, security, or serialized
contracts. It uses one implementation owner, focused stress evidence, the
relevant maintainability and reliability reviews, and one final
`verify:release` after convergence.

## Objective

Make the ordinary release suite deterministic on a clean GitHub-hosted runner:
it must collect only self-contained tests and every collected test must tolerate
valid platform-independent outcomes without weakening the behavior it proves.

## Acceptance Criteria

1. The ordinary Vitest configuration excludes the exact four test files that
   require real Datastore, a Datastore emulator, or MySQL.
2. Infrastructure tests remain available only through explicit, separately
   configured commands and cannot enter `verify:release` through ambient CI
   environment variables.
3. A permanent policy test fails when the stable/infrastructure inventories
   overlap, a listed path is absent, or an infrastructure file returns to the
   ordinary suite.
4. Self-contained child-process and loopback integration tests remain in the
   stable suite.
5. Managed shutdown proves that new work is rejected while accepting the valid
   Connect shutdown outcomes produced by server rejection or transport abort.
6. Focused tests, repeated timing-sensitive tests, typecheck, lint, format, and
   diff checks pass before review.
7. Maintainability and performance/reliability review converge, followed by one
   complete `pnpm verify:release`.

## Human-Imposed Requirements Ledger

- Create a stable test suite that works correctly on CI.
- Address every issue found inside that stable suite, including the latest
  managed remote-delivery failure.
- Tests that depend on external infrastructure must not run in ordinary CI.
- The managed remote-delivery readiness test belongs to the stable group.
- Never push to `SpineEventEngine` unless the human explicitly authorizes that
  push.
- Never create a branch with a `codex/` prefix.
- Use Standard speed and explicit repository model routing; no Max or Ultra.

## Assignment Gate

| Existing role/function | Bounded ownership                                                                                                                                         | Explicit model  | Explicit reasoning | Child spawning | Runtime metadata                                                                                                                       |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ------------------ | -------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `implementer`          | TDD for stable/infrastructure selection, explicit infrastructure commands, the managed-shutdown correction, focused verification, and task-record updates | `gpt-5.6-terra` | medium             | Prohibited     | Desktop dispatch fields are explicit; the immutable configured role/profile is acceptance evidence when self-telemetry is unavailable. |

## Verification And Review Plan

- RED/GREEN policy evidence for exact stable and infrastructure inventories.
- Credentials/service-free focused stable-suite collection.
- Repeated managed shutdown and other process-heavy focused tests.
- Cheap preflight: focused tests, tooling typecheck, ESLint, Prettier, and
  `git diff --check`.
- Style/maintainability and performance/reliability review. Documentation and
  TypeScript/API documentation are N/A because no public prose, exported type,
  declaration, or package contract changes.
- One final `pnpm verify:release` after convergence.
