# Entity and signal-handler declarations

Status: Implementation authorized on 25 September 2026; work in progress.

Branch: `entity-and-signal-handler-declarations`

## Human requirements

- Compare Entity version declarations and handler return types with Spine JVM.
- Entity versions should use Spine `Version` and advance automatically.
- Support native command unions such as `CreateAccessGrant | ExtendAccessGrant`.
- Propose a TypeScript equivalent of JVM tuple and Either return types.
- Prefer native language types; any proposed library must be maintained and
  focused on the required functionality. Inspect existing dependencies first.
- Explain findings and plans with simple words and concrete examples.
- The initial stage was analysis only. Implementation and three sequential
  independent review/fix rounds were approved afterward, on 25 September 2026.

## Investigation

The build protocol was reread after the chat model change. These proposed
changes affect public APIs, generated handler metadata, and version persistence,
so implementation will require the high-risk process after approval.

Estimated analysis time: 0.5–0.83 hours.

Use independent read-only investigations under the protocol's parallel research
rule. No child may edit files, build, run test suites, or spawn children.

| Assignment                    | Function                            | Explicit model | Explicit reasoning |
| ----------------------------- | ----------------------------------- | -------------- | ------------------ |
| Entity version investigation  | Repository and correctness analysis | `gpt-6-sol`    | `medium`           |
| Handler returns investigation | Repository and public API analysis  | `gpt-6-sol`    | `medium`           |
| Proposed plan assessment      | Existing requirements splitter      | `gpt-6-astra`  | `high`             |

Desktop exposes these explicit model/reasoning selections. Actual runtime
self-inspection is unavailable; configured dispatch fields are recorded here.

Skill selection: reviewed the session catalog and project expected-skill list.
No additional skill workflow is needed for this read-only comparison; the
repository protocol and direct source inspection govern the analysis.

## Sources and limits

The JVM comparison uses freshly fetched official `core-jvm` master, commit
`ea3067b137938ac0beb6920c39d11e300976fcc9` (24 September 2026), not the older
checked-out JVM branch. The fetch did not change that checkout.

The findings below come from source and test inspection. No builds or tests
were run for this analysis. The proposed behavior checks are future work.

The two Sol/medium investigations and the Astra/high plan assessment completed
with explicitly configured profiles. They did not edit code or start children.
Their findings are incorporated below. This was a plan assessment, not the
implementation review required after code changes.

## 1. Entity versions

### Verdict and evidence

Confirmed: the public Entity version abstraction conflicts with the required
JVM contract. It is not correct to say that TS has no automatic versioning:
repositories already calculate version numbers, but they do so separately from
the Entity API, and some paths calculate or store the wrong value.

- `packages/server/src/entity/entity.ts:325–450` permits arbitrary plain version
  metadata and adds a third generic parameter. The Entity families and
  transaction API carry it through. `test/entity/entity.test.ts:98` uses an
  object containing `revision` and `source` as a version.
- `build-protocol/DECISION_LOG.md:518` records why explicit version metadata
  was introduced before dispatch and storage existed. This explains its
  origin; it does not justify retaining the temporary design in today's
  repository runtime or establish that the human approved the final API.
- `packages/server/src/repository/repository.ts:189–208` instead expects
  `bigint` for Aggregates and `number` for Projections and Process Managers.
  Restoration uses constructor casts, so the generic does not even describe
  one consistent runtime contract.
- `packages/server/src/entity/entity-storage-descriptor.ts:57–97` already
  serializes the generated Spine `Version` inside `EntityRecord`.
- JVM `server/src/main/kotlin/io/spine/server/entity/Entity.kt:46–74` has two
  generic parameters and a fixed `Version`. `core/src/main/java/io/spine/core/
Versions.java:66–74` increments the number and sets the timestamp.

There are four concrete behavioral problems:

1. Projection persistence copies the incoming Event's producer version
   (`repository.ts:2175`) instead of advancing the Projection's counter.
   Two producer Events numbered 1 can create two different Projection states
   both numbered 1. An Event without that field can produce version zero.
   `repository-routing.test.ts:10027` currently expects missing Stand version
   information; that expectation needs correction.
2. The Entity transaction retains its starting version unless subclass code
   changes it (`entity.ts:766,905`), while repository code calculates another
   version for storage. A just-committed instance can therefore report the old
   value. Repository dispatch usually discards the instance, limiting exposure.
3. Aggregate and Process Manager current records/read updates can receive only
   the version number while history receives a timestamped version
   (`repository.ts:1455–1467,2490–2532`). Those views should agree.
4. A Process Manager producing Events without changing its state retains its
   old version (`repository.ts:2503`). Current JVM `Phase.java:90–111` also
   advances for produced Events, not just state/lifecycle changes.

Current JVM `AggregateTransaction.kt:44–50,96` advances sequentially once per
dispatch and puts the pre-dispatch producer version on emitted Events. Older
commentary in `VersionIncrement.java` describes a different aggregate strategy;
the current call sites take precedence.

### Correction

Use the generated Spine `Version` throughout. Application Entity declarations
have only ID and state-schema parameters, for example:

```ts
class AccessGrant extends Aggregate<AccessGrantId, typeof AccessGrantSchema> {
  // The framework supplies, advances, and stores this Entity's Version.
}
```

New Entities start at version zero. Restored Entities receive the stored
`Version`. Application handlers do not choose a version type or manually advance
the counter. Return defensive snapshots, as with the existing state API.

Use one timestamped next version for the Entity, current record, state history,
read updates, and relevant lifecycle notifications. Advance once after successful
handling that produces Events or changes state/lifecycle. Preserve it for a
true no-op, rejection, or failed operation. Returning only Commands without a
state/lifecycle change does not itself satisfy JVM's increment condition.
Preserve pre-dispatch producer versions on emitted Events.

For example, a Projection at version 0 receiving producer versions 100 and then
2 should advance to its own versions 1 and 2, not 100 and 2.

### Ordered implementation and acceptance

1. Replace the custom generic and arbitrary metadata helpers in Entity bases,
   transaction options/results, and repository construction with `Version`.
   Update subclasses, examples, exports, and API documentation together.
   Check two-parameter declarations, zero initialization, snapshot isolation,
   and restoration of both number and timestamp.
2. Make repository persistence and Entity transactions use the same version
   decision. Correct all three Entity families, including Projection and
   event-only Process Manager paths. Remove conflicting numeric conversions
   at those boundaries.
3. Add focused behavior cases for successive cross-producer Projection updates,
   absent producer version, multiple returned Events causing one increment,
   state-only changes, lifecycle-only changes, Events without state changes,
   Commands without state changes, no-op, rejection, rollback, and optimistic
   commit conflict. Check current record, history, Entity, and read update
   version equality, plus restoration after reopening the repository.

Relevant existing suites are `entity.test.ts`, `entity-transaction.test.ts`,
`repository.test.ts`, and `repository-routing.test.ts` under
`packages/server/test`. Storage adapter contracts should remain unchanged.

### Consequences and alternatives

This deliberately changes the snapshot public API: third generic arguments and
custom version setters disappear. There is no compatibility wrapper for the
temporary API. The existing Protobuf `Version` and `EntityRecord` wire formats
do not change; no SQL schema change is proposed. Reading a record with an absent
timestamp does not require inventing a historical timestamp. Historical wrong
Projection numbers cannot be reconstructed from a declaration change, and no
historical-data repair tool is proposed.

Keeping configurable version strategies would preserve the mismatch and add
work without a JVM requirement. Changing only the generic would leave the
actual persistence defects unfixed.

## 2. Handler return declarations

### Verdict and evidence

Partly confirmed: native unions are rejected, but fixed tuple returns already
work. There is no need to introduce Pair or Either classes.

- `packages/server/src/handler/handler-decorators.ts:179–200` does not prohibit
  the requested union. It is valid TypeScript.
- `packages/proto-tools/src/generation/build-time-handler-analyzer.ts:1657–1679`
  handles arrays, tuples, and single message references but not union nodes.
  `validateEmittedReturn` reports `UNSUPPORTED_RETURN_TYPE` at lines 1374–1384;
  `handler-codegen.ts:105–113` stops generation on that diagnostic.
- Fixed, named, readonly, and Promise-wrapped tuple cases already appear in
  `packages/proto-tools/test/build-time-handler-analyzer.test.ts:1542–1577`.
  Optional/rest tuple positions are rejected. Whole-return aliases for compound
  types are not resolved correctly; imported aliases are not followed.
- JVM's tuple package distinguishes multiple results from an Either result.
  `Pair.java:78–113` supports an optional second position; `Either.java:109–112`
  yields one selected result. Handler signature rules distinguish reactions
  that may return nothing from command-accepting handlers requiring a result.

The generator needs every possible returned schema to register and pack
messages. It currently fails to extract those schemas from a union, so it
rejects the declaration before ordinary compilation finishes.

### TypeScript-native declaration choices

```ts
// Either command may be returned; one invocation returns one of them.
@Command
issueOnApproval(
  event: AccessRequestApproved,
): CreateAccessGrant | ExtendAccessGrant {
  // Choose the appropriate generated command message.
}

// Both Events are returned, in this order.
type ApprovalEvents = readonly [AccessGrantCreated, AccessRequestCompleted];

// The first Event is required; the second is optional.
type OptionalApprovalEvents = readonly [AccessGrantCreated, AccessRequestCompleted?];
```

These are declaration examples, not complete application implementations.
Three or four outputs use three- or four-element tuples. A union can also appear
in a tuple position, and an asynchronous handler wraps its result in `Promise`.

Use existing TypeScript support, not a dependency. The repository already uses
TypeScript 6.0.3 and Protobuf-ES; dependency inspection found no dedicated
tuple/Either library. Native tuples and unions cover the required declarations,
so external-library research would not improve this proposal.

### Ordered implementation and acceptance

1. Resolve all supported return declarations to generated message schemas:
   single messages, unions, existing arrays, tuples, optional tuple positions,
   and an outer Promise. Handle named local/imported aliases and simple concrete
   generic aliases using the existing TypeScript checker. Preserve schema
   identity and command/event role checks. Reject unresolved branches rather
   than silently dropping them. Do not promise every possible conditional or
   mapped TypeScript type.
2. Keep the current flat list of possible schemas for each handler. TypeScript
   checks tuple length/order and union assignments; runtime checks each returned
   message against that specific handler's schema list. Fix repository schema
   pooling (`repository.ts:4526–4557`), which currently allows a schema declared
   only by another handler. Standalone handling already checks the invoked
   handler (`standalone-handler-runtime.ts:225–239`).
3. Preserve return order and omit absent optional tuple values. Permit an absent
   whole result only for JVM-compatible reaction kinds. Keep required-output
   rules for command-accepting handlers. Validate all results before publishing
   any, including when a later result has an invalid type.
4. Cover the exact requested `@Command` example in generated declarations and
   actual Process Manager dispatch, executing each alternative. Cover tuples,
   readonly/named tuples, repeated types, unions in tuple positions, aliases,
   Promise wrapping, and optional values. Preserve existing single/array/void
   behavior where permitted. Reject mixed command/event results, framework
   envelopes, returned rejections, unresolved types, `any`, and `unknown`.
   Include a handler returning a type declared only by its neighboring handler.
5. Document short domain-based examples showing “one of these”, “both”, and
   “this second result is optional”, with comments. Keep `@Throws` behavior
   separate and unchanged.

### Consequences and alternatives

This expands accepted TypeScript declarations without changing signal wire
formats, storage, or the generated registry's schema-list structure. No wrapper
objects need packing/unpacking and no new library is added.

Runtime schema membership is not complete runtime tuple-shape enforcement:
casts or untyped code can bypass TypeScript's checks for position and count.
Adding a serialized return-shape description solely to recheck those constraints
is not proposed. Arbitrary iterables, nested result arrays, and custom Either
classes are outside this correction.

## Execution after approval

Implement the version correction first, then handler returns. Both touch
repository execution, so one implementer should handle those files in sequence.
Use Sol/medium for implementation. Use focused tests during each change, then
the protocol's cheap preflight and relevant independent specialist reviews.
Technical review uses Sol/medium, documentation review Luna/medium, and final
security review Sol/high if required by the protocol. Record concrete reasons
for concerns that are not applicable. Use Astra/high again only if a material
contract question remains unresolved.

After corrections converge, run the shared-runtime release verification profile
once and check CI for the pushed branch. Do not use full verification as a
repeated diagnostic loop. Keep formatting, all class/method/type-parameter docs,
and domain-correct Proto fixture names/layout current as files are changed.

The final mergeable branch needs the protocol's separate version-only commit
with one common unused snapshot across workspace manifests; dependency pins
and the lockfile belong in a separate commit. Push every created commit to
official `origin` immediately. Do not create or merge a PR without instruction.

No blocking questions remain. Implementation was approved on 25 September 2026.

## Human-Imposed Requirements Ledger

- Implement both corrections described above, following current Spine JVM behavior.
- Use native TypeScript union and tuple declarations, including the exact
  `issueOnApproval` command union. Do not add unnecessary wrappers or libraries.
- Keep all explanations simple and examples domain-correct.
- Complete three sequential independent whole-changeset reviews, each starting
  with no conversation history or saved memory; fix findings between rounds.
- Keep the current branch and checkout. The human previously prohibited another
  worktree for this work. Push every feature-branch commit immediately.
- Preserve snapshot-only compatibility policy; no old-version compatibility API.
- Apply project method-length, documentation, declaration-spacing, and Proto
  naming/layout rules. Do not introduce encoded source fixtures.

## Implementation record

Start: 25 September 2026. Baseline master: `2b27a430d`.
Starting branch commit: `77b7065f1` (approved model-routing changes).
Risk: high, because Entity APIs, persistence, and generated declarations change.
Estimate: 2–3.5 hours including implementation, focused checks, documentation,
three sequential review/fix rounds, release verification, and CI waiting.

The main agent reread BUILD_PROTOCOL.md and CODE_QUALITY.md. Desktop supports
explicit Sol/medium, Luna/medium, and Astra/high child dispatch. No runtime
self-inspection is exposed; configured profiles and dispatch fields are evidence.

Implementation assignment: existing implementer, `gpt-6-sol`, `medium`; versions
first, then handler returns, one production writer. Review assignments will be
recorded before dispatch. Three whole-change rounds override the ordinary
two-round maximum because the human explicitly requested three.

Selected skills: implement, subagent-driven-development, test-driven-development;
requesting-code-review and verification-before-completion apply at their stages.
The architecture-decision-records skill guided the concise D-0127 record;
the existing decision-log format is retained.
Sources: session catalog, repo expected-skill manifest, bounded `rg --files` scan
under `/Users/armiol/.agents/skills`, and installed skill-lock presence.
Project rules override skill suggestions for a fresh implementer per subtask,
model routing, additional worktrees, and intermediate review sequencing. Reuse
one implementation context and perform the requested reviews after both items.
The existing plan and this record replace an extra skill-specific progress file.

Verification profile: release, because shared runtime and generator APIs change.
Focused tests use a single worker to keep local CPU use bounded. No full baseline
test run is planned. CI must pass at the final pushed SHA.

Additional read-only assignment: documentation/API scan, explicitly
`gpt-6-luna` / `medium`, to identify live docs and examples requiring migration.
No implementation or review conclusion is delegated to this scan.

Release preparation: registry lookup found snapshot.15 absent for all 19 public
packages. Commit `6dccc8fc1` updates only the top-level version in all 31 workspace
manifests. Pins, source manifests, lockfile, and related expectations follow in
a separate commit. Frozen install succeeded without lifecycle scripts.

Version checkpoint `ed692fbb9` is pushed: 340 focused tests, source/tooling
typechecks, and cleanup checks passed. The main agent completed Entity and Todo
TSDoc corrections. At that checkpoint repository documentation was pending: the checker found
about 350 missing method summaries plus parameter/return descriptions across
the touched files. This adds an estimated 0.5–1 hour; no check is weakened.

Repository comment assignment: existing implementer function, explicitly
`gpt-6-sol` / `medium`, limited to semantic TSDoc and declaration spacing in
`packages/server/src/repository/repository.ts`. Sol is used because the comments
require understanding transaction, dispatch, and persistence behavior across
the large module. Preparation is read-only until the runtime implementer releases
the file; then generator work and repository comments can proceed independently.
No overlapping writers are permitted. Main retains task/review records.

Analyzer comment work is limited to semantic TSDoc and declaration spacing in
`packages/proto-tools/src/generation/build-time-handler-analyzer.ts`. An explicit
Sol/medium implementer dispatch was refused by the desktop's thread limit, so no
child was created through that surface. After the runtime implementer released
the file, main attempted a fresh CLI session with the existing implementer
instructions, explicit `gpt-6-sol` / `medium`, disabled memory and child spawning.
That session failed before work: the CLI login rejected the requested model.
It produced no accepted work. The scoped checker found 533 diagnostics in the
analyzer; no rule will be weakened.
The app's installed CLI (`0.155.0-alpha.16.3`) then started successfully with
the same explicit Sol/medium assignment. Its startup metadata confirms both
fields; memory and child agents are disabled. Session:
`01a0d7ca-25d7-7503-aa51-cfe5256fba45`. No application configuration was changed.
That assignment completed: scoped TSDoc diagnostics fell from 565 to zero;
formatting and diff whitespace checks passed. It reported comment/layout changes
only, and the file was returned to the runtime implementer.
Repository comments were split at `RepositoryHistoryInternals`: main documented
that declaration through EOF, while the existing comment writer handled earlier
declarations. After both finished, repeated inline routing declarations were
replaced with two equivalent private interfaces. Formatting and the full scoped
TSDoc check passed, and the file returned to the runtime implementer.

Additional applicable skills read: typescript-advanced-types for native return
declarations; requesting-code-review, review, code-review-excellence, and
verification-before-completion for the upcoming fresh reviews and final checks.
The receiving-code-review and systematic-debugging skills govern checking
review findings against evidence and tracing failures before changing code.
The OpenAI Docs skill was used to verify a fallback for the desktop thread
limit: the installed CLI supports fresh ephemeral sessions, explicit model and
reasoning, and disabled memory. If needed, reviews use those sessions with the
existing role instructions, read-only access, and no child spawning. No review
may resume a prior session or read its memory or previous review conclusions.
Project reviewer roles/model profiles and the human's three-round requirement
take precedence over different role/model or review-count suggestions in skills.

GitHub access: saved CLI login works after removing stale GH_TOKEN/GITHUB_TOKEN
overrides from the individual command environment. Build runs only on PRs; none
exists for this branch. A nonblocking request for permission to create a draft PR
was sent to the human. No PR will be created without that approval.
