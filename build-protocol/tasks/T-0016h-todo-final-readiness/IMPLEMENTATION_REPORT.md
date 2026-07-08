# T-0016h Implementation Report

Status: DONE
Completed: `2026-07-08T17:51:36Z`

## Summary

- Verified the to-do example already uses bare `@Assign`/`@Subscribe`
  handlers, generated registry loading through
  `withGeneratedRegistryRoot(new URL("..", import.meta.url))`, framework-owned
  bounded-context repository assembly, and the framework `Server` lifecycle.
- Updated the to-do README and user guide so build, start, and focused-test
  commands are copy-pasteable after `pnpm install`, without disabling
  dependency verification in end-user instructions.
- Replaced the user-guide command posting snippet's forbidden `packCommand()`
  helper with direct public `CommandSchema` construction and `packAny()`
  payload packing.
- Clarified that ordinary clients validate with `packAny()` before posting,
  while intentionally invalid payloads can still exercise server-side
  validation acknowledgements.
- Extended the example-source cleanup guard to forbid end-user `Repository`
  access, covering the T-0016h `new Repository` requirement alongside the
  existing generated-discovery, schema-bearing-decorator, `@Apply`,
  framework-envelope, event-ID, transaction, handler-return, subscriber-return,
  and target-validation checks.
- Addressed the documentation review finding that `examples/todo/README.md`
  linked to the user guide without carrying its own copy-pasteable focused
  test and command/query/subscription client instructions. The README now has
  focused test commands and a compact local client smoke script that posts a
  command, reads a query result, receives a subscription update, and cancels the
  subscription while preserving the local-only binding and process-local
  in-memory caveats.
- Addressed second-round review findings by removing dependency-verification
  bypasses from public README/USER_GUIDE commands, adding concise `pnpm
install` prerequisites, adding required `TopicSchema.context` to the
  USER_GUIDE subscription snippet, and draining the README smoke script's
  pending subscription update promise in cleanup. Historical build-protocol
  commands keep the bypass only as execution-environment evidence.

## Changed Paths

- `examples/todo/README.md`
- `examples/todo/USER_GUIDE.md`
- `scripts/check-cleanup-rules.mjs`
- `build-protocol/tasks/T-0016h-todo-final-readiness/IMPLEMENTATION_REPORT.md`
- `build-protocol/tasks/T-0016h-todo-final-readiness/TASK.md`
- `build-protocol/work-logs/T-0016h.md`
- `build-protocol/reviews/T-0016h-todo-final-readiness.md`

## Verification

- `pnpm --config.verify-deps-before-run=false typecheck:build`: passed.
- `pnpm --config.verify-deps-before-run=false vitest run examples/todo/src/index.test.ts --passWithNoTests`:
  failed in the managed sandbox with `listen EPERM` for `127.0.0.1`; reran
  with native loopback approval and passed with 1 file and 19 tests.
- `pnpm --config.verify-deps-before-run=false lint`: passed.
- `pnpm --config.verify-deps-before-run=false format:check`: passed.
- `pnpm --config.verify-deps-before-run=false docs:check`: passed with the
  existing TypeDoc invalid-`origin` source-link warning and 0 errors.
- `git diff --check`: passed.
- `pnpm --config.verify-deps-before-run=false verify`: passed natively. Plain
  tests passed with 53 files and 882 tests; coverage passed with 94.88%
  statements, 90.02% branches, 97.73% functions, and 94.87% lines; docs/API
  checks passed with the existing invalid-`origin` warning; proto lint and
  generated-clean checks passed.
- Review-fix verification after the README documentation update:
  `pnpm --config.verify-deps-before-run=false format:check`,
  `pnpm --config.verify-deps-before-run=false docs:check`, and
  `git diff --check` passed. The first review-fix `format:check` run caught
  Markdown wrapping in this report and the review log; the matching format
  command fixed those files before the passing rerun.
- Orchestrator README smoke-script verification found that the initial plain
  `node --input-type=module` command could not resolve pnpm package
  dependencies from the workspace root. The README command now runs through
  the example package context with `pnpm --filter @spine-ts/example-todo exec
node --input-type=module`, so dependency and generated-file imports resolve
  without disabling dependency verification. The first corrected run then
  showed the subscription snippet needed `TopicSchema.context`; the README
  smoke script now passes an `ActorContextSchema` value when subscribing. The
  final rerun against the documented local server passed and printed command,
  query, and subscription success output.
- Second-round review-fix verification:
  - `pnpm format:check`: initially failed on Markdown wrapping in this report
    and the review log; `pnpm format` rewrote those files, and the rerun
    passed.
  - `pnpm docs:check`: passed with the existing TypeDoc invalid-`origin`
    source-link warning and 0 errors.
  - `git diff --check`: passed.
  - `pnpm vitest run examples/todo/src/index.test.ts --passWithNoTests`:
    sandboxed run failed only because `127.0.0.1` listener binding was blocked
    with `listen EPERM`; native loopback rerun passed with 1 file and 19 tests.
- Public-form orchestrator verification after `corepack pnpm install`:
  `pnpm typecheck:build`, `pnpm format:check`, `pnpm docs:check`,
  `git diff --check`, and native
  `pnpm vitest run examples/todo/src/index.test.ts --passWithNoTests` passed.
  Exact fixed-port README smoke verification was not rerun because an unrelated
  Java process was already listening on TCP port 8080 and was left untouched.

## Notes

- No framework features were added.
- No generated output is tracked; `examples/todo/generated/**` and
  `examples/todo/dist/**` remain ignored.
- The handoff named baseline `d7b42be`, while the existing task brief records
  baseline `2966c26`; implementation proceeded from the provided worktree
  state without rewinding or reverting.
