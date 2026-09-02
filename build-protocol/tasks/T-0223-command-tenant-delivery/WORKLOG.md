# T-0223 Command Tenant Delivery Work Log

## 2026-09-02 — start

- Estimated 1.5–2.5 hours of uninterrupted work, including realistic RED
  coverage, the narrow correction, focused checks, review, and one release
  verification.
- Fetched official `origin/master` and confirmed merge commit `5d61f6517`.
- Created `fix-command-tenant-delivery` from that exact official-master commit
  in the existing clean isolated worktree.
- Read-only diagnosis established that the durable Inbox record has a
  Command/Event payload oneof, the delivery label and runtime `Any.typeUrl`
  preserve that distinction, and Inbox conversion validates their agreement.
- Existing command-tenant coverage uses an incomplete Command containing only
  `actorContext.tenantId`. That sparse encoding happens to survive Event
  decoding. A realistic actor context containing tenant, actor, and timestamp
  reproduces `RangeError: premature EOF` when incorrectly decoded with
  `EventSchema`.
- Implementation assignment: existing `implementer` role;
  `gpt-5.6-terra` / medium explicitly selected; owns
  `packages/server/src/server/environment-delivery-worker.ts` and the focused
  environment-attachment test fixture; must not spawn subagents. Runtime
  metadata acceptance will use the immutable configured role/profile if the
  execution surface exposes no introspection.

## 2026-09-02 — TDD implementation

- Baseline command-tenant coverage passed before fixture correction:

  ```text
  pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/server/environment-attachment.test.ts -t "shared remote HANDLE_COMMAND row|multitenant HANDLE_COMMAND row pending"
  ```

  Result: 2 tests passed.

- RED: made the existing Command fixture a valid envelope with a command ID, a
  packed business `google.protobuf.StringValue`, and a `CommandContext` whose
  actor context contains tenant, actor, and timestamp. The same focused command
  test then failed as intended: the matching-tenant row was not replayed and
  the assertion timed out. This proves the old Event-first decode cannot parse
  a realistic Command payload.

- GREEN: `RuntimeDeliverySupervisorGroup.tenantKey()` now selects the envelope
  decoder from the already validated delivery label: `HANDLE_COMMAND` decodes
  `CommandSchema` and reads `context.actorContext.tenantId`; every Event label
  decodes `EventSchema` and retains the established `importContext` and
  `pastMessage` origin rules. No registry, public API, wire, or persistence
  contract changed.

- JVM parity check: `core-jvm` `Inbox.Builder` keeps typed Event and Command
  endpoint maps by `InboxLabel`, and `CommandDestinations` stores commands
  under `HANDLE_COMMAND`; this supports direct label-directed envelope handling.

- Focused GREEN evidence:

  ```text
  pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/server/environment-attachment.test.ts -t "shared remote HANDLE_COMMAND row|multitenant HANDLE_COMMAND row pending"
  ```

  Result: 2 tests passed, 93 skipped.

- Full affected-suite and changed-file preflight after the correction:

  ```text
  pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/server/environment-attachment.test.ts
  pnpm exec prettier --check packages/server/src/server/environment-delivery-worker.ts packages/server/test/server/environment-attachment.test.ts build-protocol/tasks/T-0223-command-tenant-delivery/TASK.md build-protocol/tasks/T-0223-command-tenant-delivery/WORKLOG.md
  pnpm exec eslint packages/server/src/server/environment-delivery-worker.ts packages/server/test/server/environment-attachment.test.ts
  git diff --check
  ```

  Result: all 95 environment-attachment tests, changed-file formatting, changed-file
  lint, and whitespace checks passed.

- Focused regression evidence:

  ```text
  pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/server/environment-attachment.test.ts
  ```

  Result: 95 tests passed.

- Targeted static preflight passed:

  ```text
  pnpm exec prettier --check packages/server/src/server/environment-delivery-worker.ts packages/server/test/server/environment-attachment.test.ts build-protocol/tasks/T-0223-command-tenant-delivery/TASK.md build-protocol/tasks/T-0223-command-tenant-delivery/WORKLOG.md
  pnpm exec eslint packages/server/src/server/environment-delivery-worker.ts packages/server/test/server/environment-attachment.test.ts
  git diff --check
  pnpm typecheck:build
  ```

  Result: formatting, lint, whitespace, Proto integrity/style/checksum gates,
  and TypeScript project build all passed. The repository `format:check` wrapper
  accepts no path arguments, so the equivalent direct Prettier file-level check
  was used for this scoped preflight.

## 2026-09-02 — review convergence

- Reliability/correctness review used the explicitly assigned existing
  `performance_reliability_reviewer` role with `gpt-5.6-terra` / high. Runtime
  self-introspection was unavailable; the immutable configured role/profile is
  the accepted dispatch evidence. It found that the first regression registered
  only one route and therefore did not prove isolation within a shared
  two-tenant route list.
- Style/maintainability review used the explicitly assigned existing
  `style_maintainability_reviewer` role with `gpt-5.6-terra` / high, with the
  same runtime-metadata limitation. It required the canonical
  `Human-Imposed Requirements Ledger` heading. Otherwise it found the
  production correction minimal and maintainable.
- One consolidated correction batch registered the foreign tenant route first
  and the matching tenant route second under the same remote supervisor group.
  The test now proves only the matching runtime replays the Command and that its
  replay receives tenant `match`. The task ledger heading and applicable rules
  were corrected.
- The stronger test passed without another production change. Focused Command
  selection passed 2/2, the full affected file passed 95/95, and scoped
  Prettier, ESLint, and `git diff --check` passed.
- Affected reliability and maintainability re-reviews used the same explicit
  profiles and are clean. Documentation, TypeScript/API documentation, and
  security remain N/A because no reader, public-declaration, credential, or
  trust-boundary behavior changed.

## 2026-09-02 — consolidated review correction

- Review assignments were explicitly dispatched by the orchestrator as the
  existing `performance_reliability_reviewer` and
  `style_maintainability_reviewer` roles, each configured for
  `gpt-5.6-terra` / high reasoning and limited to read-only review. The
  consolidated accepted finding required a shared-remote-route tenant-isolation
  regression and a complete human-requirements ledger. No production correctness
  finding was accepted.
- Strengthened the matching Command regression with two separate owners and
  descriptors registered under one identical remote route key. The foreign
  tenant route is registered first, the matching route second, and the test now
  proves only the matching descriptor replays `command-match` with tenant
  `match`. The existing foreign-tenant Command test continues to prove the row
  stays pending and does not replay, without adding another timing wait.
- The stronger regression passed immediately with the label-directed production
  correction already in place, so no additional production edit was needed.
- Renamed the task's requirements section to
  `Human-Imposed Requirements Ledger` and recorded the applicable branch,
  focus, TDD, behavior-preservation, concurrent-change, and no-commit/no-push
  requirements.
- Focused correction verification:

  ```text
  pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/server/environment-attachment.test.ts -t "shared remote HANDLE_COMMAND row|multitenant HANDLE_COMMAND row pending"
  ```

  Result: 2 tests passed, 93 skipped.

## 2026-09-02 — final verification

- The mandatory bounded preflight passed after review convergence:

  ```text
  pnpm verify:task -- --coverage packages/server/test/server/environment-attachment.test.ts --source packages/server/src/server/environment-delivery-worker.ts
  ```

  Result: all 95 affected tests passed. Coverage for
  `environment-delivery-worker.ts` was 92.52% statements, 90.57% branches,
  94.11% functions, and 93.47% lines. The command also passed the generated
  build, tooling typecheck, lint, cleanup, TSDoc, copyright, formatting,
  documentation, Proto, generated-clean, logging-containment, and release
  readiness checks.

- The single full release gate passed after implementation and review
  convergence:

  ```text
  pnpm verify:release
  ```

  Result: 287 test files and 4,540 tests passed. Repository-wide coverage was
  93.28% statements, 90% branches, 92.81% functions, and 94.44% lines. All 18
  framework tarballs were built and installed into the isolated external
  consumer, and its compile/runtime proof passed. No package was published.

- All acceptance criteria are satisfied. The correction is ready for human
  review on `fix-command-tenant-delivery`; it remains unpushed pending explicit
  human instruction.
