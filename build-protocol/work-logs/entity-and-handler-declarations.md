# Entity and handler declarations: work log

Task: entity-and-handler-declarations.
Branch and checkout: `entity-and-signal-handler-declarations`, existing checkout.
Start: 25 September 2026. Status: implementation in progress.

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

Version checkpoint `ed692fbb9` and analyzer checkpoint `28450b3f7` are
committed and pushed. Runtime checkpoint `2c71dfffe` and review round 1
correction checkpoint `f4746b8b7` are pushed. Later review rounds and full
release verification remain in progress.
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
