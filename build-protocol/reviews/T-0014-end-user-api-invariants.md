# Review Log: T-0014 End-User API Invariants

Status: round 28 clean; reviewers closed

Task log:
`build-protocol/tasks/T-0014-end-user-api-invariants/TASK.md`
Branch: `task/T-0014-end-user-api-invariants`
Baseline commit: `cfc950c`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0014-end-user-api-invariants`

Required review lanes:

- code style/maintainability;
- documentation;
- TypeScript/API docs;
- security;
- performance/reliability;
- JVM alignment and ADR 0001 compliance.

## Human-Imposed Requirements Under Review

- End-user handlers return generated domain messages, never ordinary framework
  `Command` or `Event` envelopes.
- End-user app code uses bare decorators; schema-bearing decorators are
  forbidden in normal app code.
- No aggregate `@Apply` in end-user code.
- No end-user transaction control such as `startTransaction()`.
- No end-user internal `EventId` generation.
- No end-user handler metadata discovery/materialization helper code.
- Default command route validates the first field before handler invocation;
  custom routes replace the default first-field route.
- The implementation must inspect Spine JVM code and ADR 0001.

## Rounds

Guardrail baseline, framework/example migration, ADR 0001 alignment, managed
persistence, documentation, security, reliability, and TypeScript/API findings
through round 28 have been addressed and verified. All current reviewer lanes
reported `CLEAN`; participating reviewer sub-agents have been closed.

Round 28 final outcome:

- code style/maintainability: `CLEAN`;
- documentation: `CLEAN`;
- TypeScript/API docs: `CLEAN`;
- security: `CLEAN`;
- performance/reliability: `CLEAN`;
- JVM alignment and ADR 0001 compliance: `CLEAN`.

Completed sub-agents:

- requirements splitter `019f3cb1-01aa-7340-8dec-cd14f94b87f6`;
- guardrail implementation `019f3cb5-848b-7f21-b724-5510afb6812c`.
- guardrail review-fix `019f3cbf-1d9b-7410-9d98-08897cb5ba7e`.

Guardrail lane update:

- `2026-07-07 14:15 WEST` — Cleanup checker review:
  `scripts/check-cleanup-rules.mjs` now scans `examples/**/src` for the
  forbidden end-user API patterns required by the task brief.
- Verification evidence:
  `corepack pnpm vitest run scripts/check-cleanup-rules.test.mjs` passed with
  focused rejection coverage plus a bare-decorator acceptance case.
- Intentional RED evidence:
  `node scripts/check-cleanup-rules.mjs` failed on
  `examples/todo/src/index.ts`, which is the expected current review signal
  until the main example migration lands.

Round 1 findings to verify fixed:

- TypeScript/API and reliability: aliases/qualified decorator names and
  framework envelope return types could bypass the guard.
- TypeScript/API, reliability, and JVM alignment: command first-field
  extraction detection was too narrow.
- Security: example source scanning could read tracked symlinks outside the
  repository root.
- Reliability: `.tsx`, `.mts`, and `.cts` example source files were skipped.

Round 1 fix verification:

- `corepack pnpm vitest run scripts/check-cleanup-rules.test.mjs` — passed
  15/15 after the review-fix pass and a local fixture reflow.
- `node scripts/check-cleanup-rules.mjs` — intentionally failed only on the
  current to-do example's known forbidden public API patterns.

Round 2 findings addressed:

- Code style/maintainability: symlink/API violations are now structured until
  converted to cleanup failures.
- Documentation: stale round/header status was reconciled.
- TypeScript/API: local non-Spine decorators and local `Event`/`Command` type
  names no longer trigger Spine-specific failures.
- Reliability: broken example symlinks now produce cleanup failures rather than
  raw filesystem exceptions.
- JVM alignment: ordinary command business field reads are allowed; the guard
  targets ID-like command field extraction.

Round 2 fix verification:

- `corepack pnpm vitest run scripts/check-cleanup-rules.test.mjs` — passed
  19/19.
- `node scripts/check-cleanup-rules.mjs` — intentionally failed only on the
  current to-do example's known forbidden public API patterns.

Round 3 findings addressed:

- Code style/JVM alignment: target-field detection no longer uses broad
  `*id` heuristics that would flag ordinary business IDs.
- Security: command target extraction diagnostics no longer echo raw source
  snippets.
- Reliability: target-field detection follows the first command-handler
  parameter name instead of assuming the parameter is named `command`.
- JVM alignment: destructuring and return-style use of the default-route target
  field are covered, while ordinary command business fields remain allowed.

Round 3 fix verification:

- `corepack pnpm vitest run scripts/check-cleanup-rules.test.mjs` — passed
  19/19.
- `node scripts/check-cleanup-rules.mjs` — intentionally failed only on the
  current to-do example's known forbidden public API patterns.

Round 4 findings addressed:

- Documentation: task header status now matches the review/work logs.
- Security: forbidden return-type diagnostics use bounded resolved labels and
  no longer echo raw source text from comments or generic arguments.
- TypeScript/API and JVM alignment: framework `Event`/`Command` envelopes are
  rejected even when nested in arrays, tuples, unions, intersections, readonly
  wrappers, generic containers, or local aliases.
- JVM alignment: framework-owned helper imports such as `packEvent`,
  `packCommand`, `EventIdSchema`, and `materializeDecoratedEntityHandlers` are
  tracked by import provenance, including aliases and namespaces.
- Reliability: nested `examples/**/src` files are scanned; destructured command
  first-parameter target fields are rejected; nested callbacks that rebind the
  command parameter name are ignored.
- JVM alignment note: this cleanup guard intentionally remains a static
  heuristic for default-route target extraction. Full first-declared-field
  enforcement belongs to the runtime/generated metadata slice, where protobuf
  descriptors and custom-route opt-out are available.

Round 4 fix verification:

- `corepack pnpm vitest run scripts/check-cleanup-rules.test.mjs` — passed
  25/25.
- `node scripts/check-cleanup-rules.mjs` — intentionally failed only on the
  current to-do example's known forbidden public API patterns.

Round 5 findings addressed:

- Documentation: task-local work log and guardrail report now include the
  round-4 fixes, 25/25 verification, intentionally red example cleanup signal,
  and re-review state.
- Security: recursive type scanning now has an explicit work budget, reports a
  bounded neutral label on budget exhaustion, and computes the forbidden return
  label once per handler.
- TypeScript/API: local recursive aliases no longer count as framework
  envelopes; type-only server imports no longer create decorator provenance.
- Reliability: `.cts` import-equals namespace imports are recognized, computed
  command target fields are checked, and namespace-qualified proto return types
  are narrowed to `Event` and `Command`.
- JVM alignment: command target extraction heuristics now apply only to
  `@Assign`; event-to-command `@Command` handlers may read event IDs. The
  developer API docs now describe aggregate mutation through framework-owned
  transactions rather than app-owned event appliers.

Round 5 fix verification:

- `corepack pnpm vitest run scripts/check-cleanup-rules.test.mjs` — passed
  32/32.
- `node scripts/check-cleanup-rules.mjs` — intentionally failed only on the
  current to-do example's known forbidden public API patterns.

Round 6 findings addressed:

- Code style: `checkExampleSourceGuardrails()` was split into smaller helpers
  for safe file resolution, per-file API collection, and violation grouping.
- JVM alignment: handlers may read command target fields as domain data. The
  static guard now rejects validation-helper calls such as
  `requireTaskId(command.id)`, not ordinary `command.id` reads.
- Reliability: type-only proto import-equals aliases and import-equals member
  aliases are covered; validation checks unwrap common TypeScript expression
  wrappers such as non-null, parenthesized, and `as` expressions.
- TypeScript/API: too-deep type graphs report `handler return type too deep to
audit` instead of pretending a framework envelope was found.
- Scope note: the current to-do example still intentionally fails the guardrail.
  That failure is the next framework/example migration input, not a reason to
  loosen the guard.

Round 6 fix verification:

- `corepack pnpm vitest run scripts/check-cleanup-rules.test.mjs` — passed
  36/36.
- `node scripts/check-cleanup-rules.mjs` — intentionally failed only on the
  current to-do example's known forbidden public API patterns.

Round 7 findings addressed:

- Documentation: the guardrail report now ends with a final current-state block
  so older historical sections do not obscure the latest status.
- TypeScript/API: type-only import-equals member aliases such as
  `import type LegacyEvent = Proto.Event` are now tracked as forbidden framework
  envelope return aliases.
- Reliability: import-equals member aliases are resolved after namespace
  collection, so declaration order no longer matters. Validation-helper calls
  through simple local aliases of command `id`/`target` fields are rejected.
- Clean lanes so far: code style/maintainability, documentation after local
  fix, security, and JVM alignment.

Round 7 fix verification:

- `corepack pnpm vitest run scripts/check-cleanup-rules.test.mjs` — passed
  39/39.
- `node scripts/check-cleanup-rules.mjs` — intentionally failed only on the
  current to-do example's known forbidden public API patterns.

Round 8 findings addressed:

- Style/maintainability: import provenance is split into smaller helpers instead
  of one large collector.
- TypeScript/API and reliability: mixed type-only core imports are ignored in
  value provenance; import-equals namespace aliases are resolved with a
  fixed-point pass; explicit handler return type rules are enforced.
- Reliability: validation-helper calls through target aliases respect simple
  block shadowing.
- Security and JVM scope: the to-do example remains intentionally RED as
  migration input.

Round 8 fix verification:

- `corepack pnpm vitest run scripts/check-cleanup-rules.test.mjs` — passed
  43/43.
- `node scripts/check-cleanup-rules.mjs` — intentionally failed only on the
  current to-do example's known forbidden public API patterns.

Round 9 findings addressed:

- TypeScript/API: `import("@spine-ts/proto").Event` and
  `import("@spine-ts/proto").Command` return annotations are rejected without
  echoing raw return-type source.
- TypeScript/API: local decorators that shadow imported Spine decorator names in
  inner scopes no longer trigger schema-bearing decorator failures.
- Reliability: chained `import =` aliases of forbidden framework envelope types
  are rejected.
- Reliability: command target validation aliases propagate through one or more
  local aliases, while nested callbacks that shadow target-alias names are
  ignored.
- Human clarification: example/application code must not define, import, or call
  decorated handler materialization helpers such as
  `materializeDecoratedEntityHandlers()`.

Round 9 fix verification:

- `corepack pnpm vitest run scripts/check-cleanup-rules.test.mjs` — passed
  49/49.
- `node scripts/check-cleanup-rules.mjs` — intentionally failed only on the
  current to-do example's known forbidden public API patterns, including the
  local `materializeDecoratedEntityHandlers` helper.

Round 10 findings addressed:

- Style: helper names now stay within the four-component rule.
- TypeScript/API: emitting handlers now reject explicit but invalid return types
  such as primitives, `void`, `undefined`, `never`, empty-capable containers,
  non-domain framework proto types, and recursive aliases.
- TypeScript/API: API docs now show non-empty tuple/rest notation for multi-event
  returns instead of `readonly T[]`.
- Security/API: local value aliases of Spine decorators are treated as Spine
  decorators, so schema-bearing decorator calls cannot bypass the guard.
- Reliability/JVM alignment: block-local return type aliases are audited, and
  function-parameter plus binding-pattern shadowing no longer produces false
  positives.

Round 10 fix verification:

- `corepack pnpm vitest run scripts/check-cleanup-rules.test.mjs` — passed
  54/54.
- `git diff --check` — passed.
- `node scripts/check-cleanup-rules.mjs` — intentionally failed only on the
  current to-do example's known forbidden public API patterns.

Round 11 findings addressed:

- TypeScript/API and JVM alignment: emitting handler return types now require
  generated Protobuf import provenance or aliases to generated imports, so
  capitalized non-message types such as `Date` are rejected.
- Reliability/JVM alignment: rest-only tuple returns such as
  `readonly [...TaskCreated[]]` are rejected because they are empty-capable.
- TypeScript/API and security: local namespace aliases, namespace destructuring,
  and object-literal aliases of framework decorators/helpers are tracked.
- Security: unknown qualified return types are rejected instead of treated as
  generated domain messages.
- Reliability: nested blocks that shadow the command parameter no longer trigger
  false command-target validation diagnostics.

Round 11 fix verification:

- `corepack pnpm vitest run scripts/check-cleanup-rules.test.mjs` — passed
  60/60.
- `git diff --check` — passed.
- `node scripts/check-cleanup-rules.mjs` — intentionally failed only on the
  current to-do example's known forbidden public API patterns.

Round 12 findings addressed:

- Documentation: non-empty tuple/rest return wording now avoids empty-capable
  array wording in the decision log and to-do example spec; build-protocol audit
  wording covers ordinary end-user/example schema-bearing decorators.
- TypeScript/API and reliability: generated namespace imports and generated value
  imports are accepted as handler return provenance.
- TypeScript/API and reliability: local type aliases shadow imported
  generated/proto names before provenance/envelope checks run.
- Security: object-literal and object-destructured decorator aliases are tracked.
- Security/reliability: object-wrapped command target aliases are rejected in
  validation-helper calls.
- JVM alignment: command-transforming `@Command` handlers receive the default
  route target-validation guard while event-to-command handlers remain allowed to
  read event IDs.
- JVM alignment: labeled non-empty tuple/rest returns are accepted.
- Reliability: target alias shadowing now follows lexical block scope.

Round 12 fix verification:

- `corepack pnpm vitest run scripts/check-cleanup-rules.test.mjs` — passed
  68/68.
- `git diff --check` — passed.
- `node scripts/check-cleanup-rules.mjs` — intentionally failed only on the
  current to-do example's known forbidden public API patterns.
