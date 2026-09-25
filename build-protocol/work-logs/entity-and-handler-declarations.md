# Entity and handler declarations: work log

Task: entity-and-handler-declarations.
Branch and checkout: `entity-and-signal-handler-declarations`, existing checkout.
Start: 25 September 2026. Status: original implementation, all three review/fix
rounds, full release verification, and package archive checks complete.
Documentation and runnable-example follow-up is in progress for draft PR #10.

Requirements and acceptance are in
[the plan](../planning/entity-and-handler-declarations.md), including its complete
Human-Imposed Requirements Ledger. No unresolved human questions.

## Assignments

- Implementation: existing implementer, explicitly `gpt-6-sol` / `medium`.
  Scope: version correction, then handler return support, related tests and docs.
  The implementation report records files and focused test evidence here.
- Main agent: task records, review coordination, release version and CI checks.

## Progress

- Official origin fetched; master remains `2b27a430d`. Existing branch preserved.
- Planning and JVM source comparison complete; no architecture replanning needed.
- Implementation dispatched after recording requirements and skill selection.
- Version slice implemented: Entity families now expose the generated Spine
  `Version` with a zero default and defensive snapshot copying. A successful
  state/lifecycle change or produced Events advances it once per dispatch;
  pure no-ops, including a fresh incomplete state, skip validation and storage.
  Repository current/history/Stand records share the committed Version;
  Projection and Process Manager versions no longer copy producer versions.
- Focused regressions cover state-only and Event-only changes, multiple input
  Events, same-timestamp Version parity, unchanged reactions, and no-op new
  Entities. Legacy third generic arguments and custom metadata helpers were
  removed from package sources, examples, and affected test declarations.
- Native handler returns now resolve union and tuple branches, optional tuple
  slots, and imported concrete generic aliases through the existing TypeScript
  checker. The generated registry carries both branches of the access-approval
  Command union; unsupported member kinds produce analyzer diagnostics.
- Repository output validation uses the invoked handler's declarations, not a
  pooled repository schema. Aggregate and Process Manager Event contexts copy
  the full pre-dispatch producer Version. Process Manager Command-only and void
  Event handling retain configured input diagnostics without persisting a
  no-op state or advancing Version. Standalone handlers omit undefined tuple
  slots and pack every output before publishing any of that handler's results.
- Package README and reference examples describe native unions/tuples and
  framework Version advancement; obsolete API export expectations were removed.

## Verification

- `pnpm exec vitest run packages/server/test/entity/entity.test.ts packages/server/test/entity/entity-transaction.test.ts packages/server/test/repository/repository-routing.test.ts packages/server/test/repository/repository.test.ts --maxWorkers=1`: 4 files, 340 tests passed.
- `pnpm exec tsc --noEmit --pretty false -p packages/server/tsconfig.json`:
  passed. `pnpm exec tsc --noEmit --pretty false -p tsconfig.eslint.json`: passed.
- `pnpm lint:cleanup`: passed. Version work used failing focused regressions
  before the relevant runtime changes. The broad TSDoc checker found baseline
  missing declarations in affected files; narrow comment correction is being
  coordinated while production behavior stabilizes, without weakening rules.
- `pnpm exec vitest run packages/proto-tools/test/build-time-handler-analyzer.test.ts packages/server/test/entity/entity.test.ts packages/server/test/entity/entity-transaction.test.ts packages/server/test/repository/repository.test.ts packages/server/test/repository/repository-routing.test.ts packages/server/test/runtime/standalone-handler-runtime.test.ts --maxWorkers=1`:
  6 files, 424 tests passed. Failing focused regressions preceded repository
  Version/context, Process Manager no-op, and standalone batch-validation fixes.
- Scoped V8 coverage of the five changed runtime test files: 364 tests passed;
  changed Entity, transaction, repository, and standalone files had 88.47%
  statements and 81.91% branches combined. Newly added Version/no-op,
  per-handler validation, optional-slot, and batch-prepacking paths were
  exercised. This scoped result is below global coverage thresholds; the
  release profile must check global coverage after reviews.
- `pnpm exec tsc --noEmit --pretty false -p tsconfig.eslint.json` and
  `pnpm exec tsc --noEmit --pretty false -p packages/server/tsconfig.json`:
  passed after handler runtime changes. `pnpm lint:tsdoc`, `pnpm lint:cleanup`,
  and `pnpm docs:api:check`: passed. Focused formatting check found four files;
  Prettier corrected them before checkpoint verification.
- Real generation and production build replaced stale Entity declarations in
  `packages/server/dist`. The initial generated-snippet run had failed on those
  old declarations; after building and updating a remaining API-doc example,
  `pnpm docs:snippets:check:generated` passed.
- A later `pnpm lint:cleanup` overlapped fixture regeneration and could not
  open a temporary `.generated.stage-*` path; this is an inconclusive staging
  race, not a source diagnostic. The main preflight will rerun cleanup after
  generation completes.
- Root tooling typecheck exposed
  six remaining third-generic Entity declarations in the black-box routing
  test; after migrating them, `pnpm exec tsc --noEmit --pretty false -p
tsconfig.eslint.json` passed and `pnpm exec vitest run
packages/server-blackbox-tests/test/project-event-routing.test.ts
--maxWorkers=1` passed 7 tests. Other old syntax found by scan is inside
  analyzer/proto-tools source-string fixtures, not compiled consumers; its
  negative and compatibility meanings were checked, then the obsolete generic
  arguments were removed without changing the scenarios. Analyzer and
  proto-tools focused tests passed 200 cases after migration.
- Targeted ESLint on changed server, proto-tools, and black-box files passed.
  Main cheap preflight reported passing API/audience docs, cleanup, TSDoc,
  Proto lint/generated cleanliness, copyright, logging, production dependency,
  and release-readiness gates after generation settled.
- Final focused rerun after consumer and lint corrections passed 431 tests in
  seven runtime, analyzer, and black-box files with one Vitest worker. Prettier
  passed on all pending task files, and the diff had no whitespace errors.
- Full release verification follows three completed review-and-fix rounds.

## Review round 1 corrections

- Aggregate Event reaction now retains its source diagnostic in the same atomic
  commit as changed state and produced Events; unchanged reactions keep the
  existing diagnostic-only append path. A counter reactor test failed first
  because the old path exposed state after diagnostic append failure, then
  passed when a failed commit left no state and retry stored count one.
- Process Manager Event execution packs declared Command and Event outputs
  before any persistence or publication. A malformed later Command test failed
  first because state was visible after rejection, then passed with no state or
  produced Event persisted. The test awaits Inbox replay rather than merely
  observing enqueue completion.
- Analyzer red tests reproduced an optional union tuple member being rejected,
  an imported outer Promise alias being rejected, and a nested array alias
  being accepted. All three turned green while the complete analyzer file
  remained green. The existing TypeScript checker resolves imported aliases;
  no separate return type system was added.
- Reference docs now show decorated native-return handlers. Standalone tests
  use a real undeclared Event and assert result order by unpacked payload IDs.
- Focused single-worker Vitest run of analyzer, repository routing, and
  standalone runtime passed 355 tests. Root tooling and server TypeScript
  checks, `pnpm lint:cleanup`, `pnpm lint:tsdoc`, targeted ESLint, and
  `pnpm docs:snippets:check:generated` passed after corrections. The cleanup
  rule required small behavior-preserving helper extractions in touched files.

## Integration

Version checkpoint `ed692fbb9`, analyzer checkpoint `28450b3f7`, runtime
checkpoint `2c71dfffe`, all three review corrections, and final integration
fixture correction `bee9c9305` are committed and pushed. Full release
verification passed on `bee9c9305`.
No PR creation is authorized yet; the request remains unanswered.

## Review round 2 corrections

- Aggregate Command execution now unpacks and validates manually returned Event
  envelopes against the invoked handler's declared Event schemas before
  committing. Undeclared and malformed packed payload regressions were red
  against the previous behavior, then green with no Stand or EventStore record.
  Explicitly declared valid manual envelopes still pass. Nine older test
  fixtures now declare their own expected Event outcomes.
- The analyzer accepts a missing whole result for `@React` Event reactions,
  including imported aliases and outer Promise returns. A red three-method
  regression turned green. Command-accepting optional results and unknown
  reaction branches remain unsupported, with a new negative test.
- Compiler-checked virtual Protobuf fixtures now prove that the exact
  access-approval Command union and an imported union/optional tuple alias
  compile under strict TypeScript and current decorators, in addition to
  generating both schema alternatives. The optional reaction alias test enables
  strict null checking so its missing branch remains visible. The initially
  loose virtual schemas could not establish the compiler claim and were
  replaced in these positive fixtures only.
- Repository class documentation now describes full Process Manager Versions.
  Aggregate, Projection, and Process Manager Stand notifications pass deferred
  updates directly instead of forwarding through single-use callbacks.
- Focused single-worker Vitest: 6 files, 433 tests passed. Root tooling and
  server TypeScript checks, targeted ESLint on four changed files,
  `pnpm lint:cleanup`, and `pnpm lint:tsdoc` passed. Formatter and diff checks
  follow the durable-log update before the correction checkpoint.

## Review round 3 corrections

- An existing Entity transaction with prior state A and an already supplied
  draft B was reproduced as a false no-op: a valid B kept A's Version, and an
  invalid B bypassed transition validation. State-change detection now compares
  with prior committed state when present, retaining the initial draft as the
  no-op baseline only for a fresh Entity. Both regressions were red before the
  fix and green afterward; the unchanged incomplete new-Entity case still
  passes.
- Imported `Result -> AsyncResult -> Promise<TaskCreated>`, concrete generic
  `AsyncResult<TaskCreated>`, and a local generic alias now resolve through the
  TypeScript checker to exactly one built-in Promise layer. Strict compiler
  diagnostics and generated metadata assertions pass. Imported nested Promise,
  custom thenable, and an outer Promise wrapping another Promise alias remain
  rejected. The analyzer regression was red before the checker-based fix.
- The routing history test now asserts every returned record has a Version and
  compares the complete Version list. Its renamed fixture describes Spine
  Version messages rather than the former bigint representation.
- Focused single-worker Vitest: 6 files, 437 tests passed. Root tooling and
  server TypeScript checks, targeted ESLint, `pnpm lint:cleanup`, and
  `pnpm lint:tsdoc` passed. The orchestrator will run the full release profile
  once after the review convergence checkpoint.

## Final verification

All three correction checkpoints are pushed: `f4746b8b7`, `c01966b29`, and
`97ea44d0c`. The final cheap checks include 437 focused tests, strict TypeScript,
lint, cleanup, TSDoc, formatting, compiled documentation and audience checks.
The selected final profile is `pnpm verify:release`, followed by
`node scripts/release-cli.mjs prepare --check`, matching the Build workflow.
No publication is requested or performed.

The first full release run passed the generation, build, type, lint, formatting,
documentation, dependency, and release-readiness checks. Its test phase ended
with 4,953 passing and three failing tests across 302 files (300 passing).
The failures were two BlackBox subscription/query tests and one native
Aggregate subscription test. Their old manual handler fixtures did not declare
the Events returned by the invoked Command handler, so the new per-handler
output validation correctly rejected those results before publication.
The run did not establish a passing global coverage result.

The correction adds explicit output metadata to those two fixtures without
changing runtime validation or timeouts. The two affected Vitest files pass
20 tests, and the shared BlackBox Node contract passes 16 tests. The complete
cheap preflight was repeated before the second full release attempt.

The second `pnpm verify:release` run passed with exit 0 on `bee9c9305`:
302 test files and all 4,956 tests passed. Global coverage passed without
threshold changes: statements 93.29%, branches 90.11%, functions 93.06%, and
lines 94.46%. Its test phase took 714.03 seconds with one worker. Generation,
build, tooling typechecks, lint, cleanup, TSDoc, formatting, compiled
documentation, Proto, logging, dependency, and release-readiness checks also
passed. The working tree remained clean after verification.

`node scripts/release-cli.mjs prepare --check` then passed with exit 0. It
packed the release archives and checked their use in a separate consumer
project. No package was published. The final follow-up changes only these
planning, work-log, and review records; runtime and test source remain exactly
as verified at `bee9c9305`.
No production source or branch changed in this correction. The earlier scoped
coverage inspection of Entity, transaction, repository, and standalone output
branches remains applicable; the full gate must still establish global coverage.
The repeated cheap preflight passed: focused Vitest 20/20 in the two failed
files, shared BlackBox Node contract 16/16, testing/server/tooling TypeScript
checks, targeted ESLint, cleanup, TSDoc, generated API/audience/snippet docs,
changed-file Prettier, and `git diff --check`.

The human subsequently opened draft PR #10. Build verification is running on
`d766f60b0`; follow-up pushes must establish fresh CI results on their final SHA.

## Documentation and runnable-example follow-up

The four new human requirements and acceptance criteria are recorded in the
plan. Main reread the protocol. The existing implementer, explicitly configured
Sol/medium, is assigned only example sources, their tests, and app documentation.
Main handles framework documentation/TSDoc and records in separate files.
A fresh `declaration_docs_audit` documentation reviewer was dispatched with
explicit Luna/medium, no inherited history or memory, no edits, and no children.
It checks current documentation for outdated Entity and handler declarations;
historical records remain historical. Desktop accepted the explicit dispatch.
Self-reported runtime identity is not available beyond configured dispatch.

The original full release evidence remains applicable to unchanged framework
runtime. Follow-up verification will exercise real examples, generated handler
metadata, documentation snippets, and the full branch's required task gates.
PR #10 is attached to this task. No PR creation or merge was performed.

The independent documentation audit found the stale synchronous-only example
comment, missing return-form TSDoc, and missing user-guide coverage. All were
accepted. Main also removed outdated architecture wording that called Entity
families marker-only and described their implemented collaborators as absent.
Current documentation scans found no remaining third Entity generic example.

The decorator file's newly enforced private-helper documentation is now complete.
Three internal callbacks reuse the existing contextual HandlerMethodDecorator
type rather than repeating its generic parameters. TypeScript output with
comments removed is byte-identical to the baseline; server typechecks, ESLint,
TSDoc, and all 14 decorator tests pass. No framework runtime behavior changed.
The user-installed skill entrypoints were confirmed with bounded `rg --files -L`
filtering and the local `.agents/.skill-lock.json` source manifest was readable.

The real To-Do example now uses a readonly optional tuple at task creation and
a two-Event-type union for assignment. Both new behavior tests first failed on
the baseline. Generation, scoped compilation, and all 45 To-Do black-box tests
pass after implementation. Remaining preflight and independent review follow.
The selected final profile is now `verify:release`, because `verify:task`
requires the complete branch's tests too; only one final profile will run.

Preflight exposed an outdated example-code checker: it rejected the newly valid
union and optional tuple declarations and still accepted a variadic tuple that
the actual handler analyzer rejects. The same Sol/medium implementer now also
handles `scripts/check-cleanup-rules.mjs` and its tests. Correct its native-form
checks with positive and negative regressions, preserving generated-message
roles and required outputs; do not add another full compiler analyzer.
The estimate is revised to 0.8–1.2 hours. This shared-checker correction makes
full release verification mandatory independently of branch classification.

Follow-up implementation and cheap preflight are complete. The checker regression
matrix failed on the old implementation and passed after correction. Its full
125-test file passed, followed by the affected positive/negative matrix after
the final React optional-only tuple and shadowed-Promise checks. The cleanup
gate, TSDoc, root tooling/server typechecks, targeted ESLint, changed-file
formatting, whitespace checks, compiled documentation snippets, audience checks,
and API documentation/export checks passed. The new example branches are covered
by initial/replacement/duplicate assignment and present/absent initial-assignee
cases; global coverage will be checked in the final release run.

The To-Do command adds only optional field 4; existing requests still decode and
create unassigned tasks. Existing message types are reused with correct roles.
The revised AssignTask semantics are documented beside the unchanged strict
ReassignTask. An inline context-options type was named privately to keep the
touched context factory within the method-length rule. Generated changes are
limited to To-Do's normal manifest/marker; no generated TypeScript was added.
