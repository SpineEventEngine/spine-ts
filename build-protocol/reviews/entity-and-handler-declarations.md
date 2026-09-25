# Entity and handler declarations: reviews

Status: all three fresh review/fix rounds complete; all findings addressed.

Each of three rounds must use fresh reviewers with no inherited history and no
saved memory. Review the full branch changeset against the human requirements
in [the plan](../planning/entity-and-handler-declarations.md). Finish corrections
and their focused checks before starting the next round.

## Required concerns

- Code style and maintainability: all findings corrected and checked.
- Documentation completeness: rounds 2 and 3 clear.
- TypeScript and public API: all findings corrected and checked.
- Performance and reliability: all findings corrected and checked.

All four concerns apply: runtime behavior and persistence, public declarations
and generated metadata, substantial source structure, and public documentation
are changed. Final security review is not a separate task review: the protocol
reserves that role for project release-readiness or an explicit security request.
This task changes no authentication, authorization, credential or network boundary.

## Review execution

The desktop refused another child because its thread limit was reached. The
app's installed CLI supports the required explicit profiles, so each specialist
review may run in a new ephemeral CLI session. Memory use and generation are
disabled, as is child spawning. Reviewers receive current requirements and the
fixed diff, not implementation history or previous review conclusions.

Expected profiles: existing style/maintainability, TypeScript/API, and
performance/reliability roles use explicit `gpt-6-sol` / `medium`; the existing
documentation role uses explicit `gpt-6-luna` / `medium`. Read-only reviews run
at standard speed. Up to three independent concerns run in parallel; any fourth
waits for capacity. Each round collects all results before corrections begin.

## Rounds

1. Reviewed `2c71dfffe462dbdbad663d43dd78c77322113ae5` against the master
   baseline `2b27a430da213438d600aff8d4a6cdfb7c0cec98`; eight findings
   corrected, checked, and pushed in `f4746b8b7`.
2. Reviewed `f4746b8b7f41db9e916658f0085b4265bc63cd92` against the same
   master baseline; five findings corrected, checked, and pushed in `c01966b29`.
3. Reviewed `c01966b2958fee434914c01fb79a5c787e4a66ad` against the same
   master baseline; four findings corrected, checked, and pushed in `97ea44d0c`.

Record reviewer identity, explicit model/reasoning, checked commit, findings,
decisions, correction evidence, and completion here at each round boundary.

## Pre-review checks

Fresh Proto generation and the production build passed. The tooling and
documentation typechecks exposed missed three-parameter Entity declarations
in black-box tests and an API example; these are being migrated before review.
Generator source fixtures are included in that scan. The complete ESLint scan
also identified eleven local callback/import/test typing corrections.
These deterministic findings were corrected in `2c71dfffe`, before review.
The wider tooling typecheck, compiled documentation snippets, targeted ESLint,
formatting, 431 focused behavior tests and 200 Proto-tools tests passed.

The API documentation, audience, cleanup, TSDoc, Proto lint, generated-output,
copyright, logging and production-dependency checks passed. The earlier cleanup
failure was a check running during generation; rerunning after generation passed.

### Round 1 assignments

Explicit expected profiles and actual startup metadata agree:

- Performance/reliability: Sol/medium, session
  `01a0d7e7-767c-75b2-baa4-d9caa91fffcb`.
- TypeScript/API: Sol/medium, session
  `01a0d7e7-76a1-7530-8c97-7c42c2028e49`.
- Documentation: Luna/medium, session
  `01a0d7e7-788c-7871-89fc-2eac192f2246`.
- Style/maintainability: Sol/medium, session
  `01a0d7e8-60e4-7ec1-83e8-208f90014ef0`, started after documentation finished.

All sessions are new, ephemeral and read-only, with memories and child agents
explicitly disabled. Inputs contain requirements and concern-specific paths;
prior review results and implementation logs are excluded.

Documentation reported one confirmed omission: the new return-type example
contains comments only, not an actual handler. Replace it with usable union
and tuple handler examples.

Reliability reported two confirmed ordering defects: Aggregate reactions commit
before appending source diagnostics, and Process Manager Event handling packs
Commands after committing and publishing Events. The first needs diagnostics in
the existing atomic commit; the second needs all result packing before commit.
Both require failure-path regression tests.

Style reported two confirmed test gaps: the undeclared Event fixture returns an
Entity state, and the ordering test compares identical type URLs instead of
distinct payload IDs. Use a real undeclared Event and assert payload order.

TypeScript/API reported three analyzer inconsistencies: optional tuple slots
containing unions fail, imported aliases to an outer Promise fail, and aliased
nested result arrays pass. The implementer must first reproduce these cases
with focused tests, then correct them without weakening the other shape checks.

All eight findings were returned as one batch to the original implementer.
The reviewers performed read-only source/test inspection, not independent
test execution. Mechanical evidence is recorded separately in the work log.

### Round 1 correction evidence

All three analyzer examples first failed as reported; the corrected analyzer
passes all 63 tests. The Aggregate and Process Manager regressions also failed
before correction, exposing state through Stand after failed handling. Both
now pass: source diagnostics join the existing Aggregate atomic commit, and
Process Manager Commands are packed before persistence or publication.

The guide now contains compiled decorated handler examples using generated
review-domain messages. The standalone fixture uses a real undeclared Event,
and the ordered-output assertion checks unpacked IDs. All 17 standalone tests,
the focused snippet compiler, ESLint and formatting passed. Main handled these
three independent documentation/test corrections while the implementer handled
the five runtime/analyzer findings; no production files had concurrent writers.

No finding was dismissed. Combined checks and the pushed correction commit
are recorded before round 2 starts.

All eight corrections were committed and pushed in `f4746b8b7`. The combined
affected tests passed 355/355, both tooling and server typechecks passed, and
cleanup, TSDoc, ESLint, compiled snippets, formatting and diff checks passed.

### Round 2 assignments

Explicit expected profiles and actual startup metadata agree:

- Performance/reliability: Sol/medium, session
  `01a0d802-d6bd-7c02-85b2-18eac816a0b0`.
- TypeScript/API: Sol/medium, session
  `01a0d802-db29-7083-a4b4-3de42ab789a7`.
- Documentation: Luna/medium, session
  `01a0d802-dfbc-7fb1-85b0-2734edb45280`.
- Style/maintainability: Sol/medium, session
  `01a0d804-e2b9-7643-bc96-bfe72faae112`, started after documentation finished.

These are new read-only sessions, with memory and child agents disabled.
They receive the original requirements and complete branch comparison, split
by concern, without earlier review findings or implementation history.

### Round 2 findings

- Documentation: no actionable findings.
- Reliability: Event envelopes bypass the invoked Aggregate handler's schema
  check. Validate their packed payload against that handler's declarations,
  retaining valid manually configured envelope support.
- TypeScript/API: a whole `Event | undefined` reaction return is rejected even
  for reactions permitted to produce nothing. Support that declaration while
  preserving required output for command-accepting handlers. Repository class
  TSDoc also still describes Process Manager versions as numeric; correct it.
- Style/maintainability: positive native-return fixtures assert only analyzer
  diagnostics, not TypeScript compiler diagnostics. Add the compiler assertion.
  Notification helpers add callbacks solely to invoke deferred update methods;
  pass the deferred update directly and remove unnecessary forwarding layers.

Main confirmed the envelope bypass and optional-result rejection in the source.
All five findings were returned together to the original implementer for focused
regressions and corrections. The reviewer reports contain no executed tests;
correction checks will provide that evidence before round 3.

### Round 2 correction evidence

Undeclared and malformed Event envelopes first reached successful command
completion in regression tests; corrected handler execution fails before storage
or publication, while preserving declared manual envelopes. CommandBus reports
admitted handler failures separately and still resolves `post()`. Nine older fixtures
now declare their handler's returned schemas explicitly. All 277 routing tests
pass. Missing whole reaction results now work for direct, aliased and Promise
returns; required Command outputs and unknown branches remain rejected.
All 65 analyzer tests pass.

Positive exact-union and imported union/tuple examples now also assert zero
TypeScript pre-emit diagnostics under strict checking. This exposed weak fixture
schema types and legacy decorator settings, which were corrected rather than
ignored. The optional reaction alias test enables strict null checking.
Repository TSDoc now states full Spine Version, and deferred update objects are
passed directly instead of through redundant callback wrappers.

No finding was dismissed. Final mechanical checks and the correction push
precede the third fresh review round.

The five corrections were committed and pushed in `c01966b29`. All 433 focused
tests passed, together with tooling/server typechecks, ESLint, cleanup, TSDoc,
formatting and diff checks.

### Round 3 assignments

Explicit expected profiles and actual startup metadata agree:

- Performance/reliability: Sol/medium, session
  `01a0d81a-2938-7843-b900-7d576621da4d`.
- TypeScript/API: Sol/medium, session
  `01a0d81a-2dd0-7e30-afa6-2dbe3adbf92b`.
- Documentation: Luna/medium, session
  `01a0d81a-325c-7ff3-bef5-8d4ff4296eb5`.
- Style/maintainability: Sol/medium, session
  `01a0d81c-8044-75c1-a2cf-418d83a8e9b9`, started after documentation finished.

Each session is fresh, ephemeral and read-only, with memory and child agents
disabled. They have the original requirements and the full branch comparison,
split by concern, without preceding review reports or implementation logs.

Round 3 documentation review is clear. TypeScript/API found that an imported
alias chain ending in Promise is rejected because unwrapping accepts only a
direct alias body. Main also identified the same restriction for concrete
generic Promise aliases; both forms need regression reproduction and one
checker-based correction.

Reliability found that a public transaction with previous state A and supplied
draft B incorrectly compares against B to detect changes. Compare against A
when present; retain the initial-draft baseline for unchanged fresh Entities.
Regression tests must cover validation and version advancement.

Style found a history helper that drops records with missing Versions and a
fixture still named for bigint versions. Main is correcting these two test-only
issues in the routing test, while the original implementer corrects the analyzer
and transaction in separate files. The full finding batch was collected before
any correction started. No finding was dismissed.

### Round 3 correction evidence

The supplied-draft transaction regressions first demonstrated skipped validation
and version advancement. Comparing against prior state when present corrects
both; all 30 transaction tests pass, including fresh no-op behavior.
Imported alias chains and local/imported concrete generic Promise aliases first
failed, then passed through checked built-in Promise resolution under strict
compiler checking. Nested Promise and custom thenable negative cases still pass.

The history assertion now checks every record and fails if any Version is
missing. The fixture and helper names describe Spine Version messages. All 277
routing tests and their lint/format checks passed. Final combined checks and
the correction checkpoint precede the one repository-wide release verification.

The final correction checkpoint `97ea44d0c` is pushed. The combined 437 tests,
tooling/server typechecks, ESLint, cleanup, TSDoc, formatting and diff checks
passed. All seventeen reviewer findings across the three rounds were addressed;
the related generic Promise-alias case found by main was corrected with the
same checker-based change. No review used memory or earlier review results.

After review convergence, full integration testing identified two older manual
handler fixtures missing their returned Event declarations. Fixture-only
correction `bee9c9305` preserves the reviewed runtime contract and passes the
affected tests and repeated cheap preflight. The subsequent full release run
passed all 4,956 tests and global coverage; package archive/consumer verification
also passed. No production change followed the third review correction.

The combined focused run passed 437 tests in six files with one Vitest worker.
Root tooling and server TypeScript checks, targeted ESLint, cleanup, and TSDoc
passed. The correction checkpoint will be pushed before release verification.
