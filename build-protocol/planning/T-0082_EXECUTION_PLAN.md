# T-0082 Execution Plan

Status: Completed and accepted for integration.

Baseline: `7407cc9d33f707bf01431426de09aa029ad44646`

Classification: High-risk. T-0082 changes shared authored-code enforcement,
normal event admission before persistence, generic generated rejection
contracts, every workspace version, example Protobuf packages/type URLs and
physical paths, Chat model topology, and repository-wide public documentation.

## Execution Rules

- Execute the ten slices below in order in the T-0082 worktree. Use one
  `gpt-5.6-terra`/medium implementation owner at a time. No two writers may own
  overlapping production, example, generated-tooling, package, or documentation
  paths concurrently.
- Record the full Human-Imposed Requirements Ledger from `TASK.md` in every
  slice brief or reference it by exact path. A reviewer prompt must receive the
  same ledger and the protected-file prohibition.
- Freeze a literal endpoint after each slice. Run its focused mechanical gate
  before relevant review. Collect a complete applicable review wave before
  returning one correction batch to the same implementation context.
- Generated Protobuf, entity-column, handler-registry, and TypeDoc output stays
  ignored and uncommitted. Tracked `spine-proto-manifest.json` files and the
  lockfile are configuration evidence and may change in their assigned slices.
- A focused gate may be red between the enforcement slice and the remediation
  slice that owns the exposed debt. No such intentionally red state may be
  accepted, committed as a completed endpoint, merged, or pushed.
- Mechanical work is limited to deterministic comment-layout normalization,
  import/path rewrites derived from one mapping, version propagation from the
  root manifest, manifest regeneration, and formatting. Meaningful summaries,
  Proto domain language, validation placement, generated contract design,
  model ownership, README teaching flow, and technical claims require human
  judgment and the named specialist reviews.
- Do not read or touch either protected human-review file. Do not inspect or
  build Spine JVM. Do not edit frozen upstream Protobuf definitions.

## Dependency Order

```text
S1 TSDoc enforcement
  -> S2 package TSDoc remediation
  -> S3 server/example/tooling TSDoc remediation
  -> S4 framework signal validation
  -> S5 generic rejection + example Proto enforcement
  -> S6 Chat model/contract migration
  -> S7 Todo, Projects, and Orders contract/path migration
  -> S8 root-authoritative workspace version
  -> S9 package human/agent documentation
  -> S10 repository documentation audit and final closure
```

S6 and S7 are conceptually independent after S5, but remain serial because
they overlap root generation configuration and generated-clean verification.
S8 follows them so it does not version or lock a Chat module that S6 removes.

## S1 — Enforce the Handwritten TSDoc Contract

**Depends on:** accepted plan only.

**Owned paths:**

- `scripts/check-tsdoc.mjs`
- `scripts/check-tsdoc.test.mjs`
- `build-protocol/CODE_QUALITY.md` for the authoritative authored
  documentation rules
- `package.json` only if the existing lint entry needs a narrowly scoped
  invocation adjustment

**Acceptance:**

- The checker applies block-layout rules to all tracked handwritten
  TypeScript/JavaScript source, tests, and tooling (`ts`, `tsx`, `mts`, `cts`,
  `js`, `jsx`, `mjs`, and `cjs`) while excluding generated output, `dist`,
  dependencies, and frozen sources.
- Every block starts on a line containing only `/**`; one-line blocks fail.
- A blank line must precede a block except when `/**` is the first content at
  byte zero; a file beginning with a blank line fails.
- `@param name Description` is accepted and `@param name - Description` fails.
- `Owns`, `Consists`, placeholders, or other summaries that do not explain
  behavior or meaning fail. Existing semantic coverage remains required only
  for public production/example declarations; tests and tooling receive the
  layout rules without an invented public-coverage requirement.
- Diagnostics are deterministic, path-confined, deduplicated, and identify the
  rule, file, and declaration/block.
- `build-protocol/CODE_QUALITY.md` records the same enduring TSDoc, Protobuf
  documentation, package README/REFERENCE, and example-domain rules so future
  tasks and reviewers apply them without consulting T-0082 history.

**RED:** add isolated Git-fixture cases for a one-line block, decorated opener,
missing preceding blank line, blank first line, hyphenated `@param`, vague
`Owns`/`Consists`, and violations in tests and `.mjs` tooling. Prove each new
case fails before checker implementation.

**GREEN:** make every new fixture pass only after correcting its source; retain
all existing semantic-coverage, path-confinement, duplicate, and debt tests.

**Focused gate:**

```bash
pnpm exec vitest run scripts/check-tsdoc.test.mjs
node scripts/check-tsdoc.mjs
pnpm exec prettier --check scripts/check-tsdoc.mjs scripts/check-tsdoc.test.mjs
git diff --check
```

The repository invocation is expected to report the exact S2/S3 remediation
inventory until those slices are complete.

**Review lanes:** style/maintainability and TypeScript/API docs required;
documentation required for rule meaning; performance/reliability N/A because
this slice changes no runtime/resource behavior.

**Risk/exclusion:** this slice detects debt but does not mass-edit comments,
change TypeScript APIs, or add an unrelated documentation linter.

## S2 — Remediate Foundation, Storage, Client, and Auth TSDoc

**Depends on:** S1 fixtures and checker behavior fixed.

**Owned paths:**

- Authored code and mirrored tests/tooling under
  `packages/{core,proto,storage,transport,storage-datastore,storage-rdbms}/`
- Authored code and mirrored tests under
  `packages/{auth,client-node,client-web,client-react}/`
- The corresponding entries in `build-protocol/tsdoc-debt/*.json`, if the
  checker still uses those partitions during the transition

Generated directories, frozen `packages/proto/proto/**`, package READMEs, and
production behavior are excluded.

**Acceptance:**

- Every handwritten TSDoc block in the owned paths conforms to S1.
- Mechanical block expansion and `@param` hyphen removal preserve text when it
  is already meaningful.
- Vague summaries are rewritten to state observable behavior or domain meaning,
  not replaced by uniform boilerplate.
- Public declaration coverage and TypeDoc meaning do not regress.
- No source behavior, export, dependency, or test expectation changes.

**RED:** run `node scripts/check-tsdoc.mjs` and retain the owned-path failure
inventory. Add no debt exemptions for new layout rules.

**GREEN:** the same checker reports no failures in the owned paths; focused
package typechecks/tests prove comment-only edits did not alter parsing or
declarations.

**Focused gate:** `check-tsdoc`, focused package typechecks/tests,
`docs:check:generated`, Prettier over changed files, and `git diff --check`.

**Review lanes:** documentation and TypeScript/API docs required; one bounded
style/maintainability review confirms the mechanical transformation did not
damage source readability; performance/reliability N/A.

**Risk/exclusion:** layout conversion is mechanical, but summary rewriting is
not. Do not rewrite package README prose here.

## S3 — Remediate Server, Delivery, Tooling, Testing, and Example TSDoc

**Depends on:** S2 accepted.

**Owned paths:**

- Authored code and tests under
  `packages/{server,delivery-server,delivery-client,proto-tools,testing}/`
- Handwritten code, tests, and tooling under `examples/**`
- Repository tooling under `scripts/**`, TypeScript/JavaScript tooling under
  `docs/**`, `compatibility-tests/**`, and `interop/**`
- Remaining `build-protocol/tsdoc-debt/*.json`

Exclude generated/dist output, Markdown prose, example Proto, frozen upstream
sources, and the protected files.

**Acceptance:**

- The repository-wide S1 checker is green with no TSDoc debt entry needed.
- All handwritten source/test/tooling blocks follow the same layout; public
  production/example APIs retain meaningful coverage.
- Comments on runtime/reliability code describe current observable semantics
  and do not introduce or preserve unsupported claims.
- Empty obsolete T-0080 TSDoc debt partitions are removed only after the
  checker passes without them.

**RED:** capture S1 failures for each owned path group, including tests and
`.mjs` tooling.

**GREEN:** `node scripts/check-tsdoc.mjs` passes repository-wide and a second
run returns the same clean result.

**Focused gate:** focused changed-package tests and typechecks, script tests,
`pnpm docs:check:generated`, Prettier, generated-clean check, and
`git diff --check`.

**Review lanes:** documentation and TypeScript/API docs required;
style/maintainability required for the large authored-source transformation;
performance/reliability required only for changed reliability/lifecycle claims,
otherwise record a concrete N/A.

**Risk/exclusion:** this is the last comment-only slice. It must not opportunistically
change runtime behavior, Proto contracts, example paths, or package prose.

## S4 — Validate Every Framework-Owned Normal Signal Intake

**Depends on:** S3 clean enforcement.

**Owned paths:**

- `packages/server/src/bus/event-bus.ts`
- `packages/server/src/bus/event-dispatcher-registry.ts`
- `packages/server/src/bus/event-dispatcher.ts` only for accurate existing
  contract wording
- `packages/server/src/repository/repository.ts` for internal access to the
  repository's already-computed produced event schemas
- `packages/server/src/context/bounded-context.ts` for build-time schema-only
  registration before repository runtime binding
- `packages/server/test/bus/event-bus.test.ts`
- `packages/server/test/repository/repository-routing.test.ts`
- `packages/server/test/context/bounded-context.test.ts`
- Narrow command-bus/runtime regression tests only where needed to prove
  command validation remains unchanged

**Acceptance:**

- Normal event intake resolves the registered generated message schema,
  unpacks the `Any`, and calls the existing `@spine-event-engine/core`
  validation facade before persistence, dispatcher acceptance, handler code,
  or subscriber notification.
- Invalid fresh events on `post()` and fresh follow-up intake are neither
  persisted nor dispatched. Already-stored/replay intake validates before user
  code but never appends again.
- Each path validates one payload once; it does not validate again in every
  matching dispatcher.
- A type without a registered schema cannot enter the normal fresh persistence
  path unvalidated. Malformed envelopes and type/schema mismatches remain
  deterministic failures.
- CommandBus schema validation remains framework-owned and unchanged.
- No public validation class, option, decorator, or example-specific API is
  added.
- Producer-only schemas are registered through existing internal access seams
  without synthetic dispatchers or consumer routes. Repository-produced schema
  metadata is deduplicated and immutable.

**RED:** add event-bus tests using a schema with validation options and prove
that invalid normal, follow-up, and stored/replay events currently reach the
store or user seam. Assert store/accept/dispatch/subscriber call counts are
zero at the required boundary.

**GREEN:** all invalid paths reject before their boundary, valid paths preserve
store-before-dispatch ordering, and an instrumentation test proves exactly one
schema validation per admitted path.

**Focused gate:** event-bus and command-bus suites, relevant event-store and
bounded-context regressions, server typecheck/lint/format, TSDoc check,
generated-clean check, and `git diff --check`.

**Review lanes:** style/maintainability, TypeScript/API docs, and
performance/reliability required; documentation required if public bus wording
changes. Performance/reliability review is Terra High because admission order,
persistence, replay, and duplicate work are affected.

**Risk/exclusion:** high-risk boundary. Do not redesign `Validate`, add a second
validation abstraction, alter transactions, or preserve Chat-only invented byte
limits.

## S5 — Make Rejection Generation Generic and Enforce Example Proto Quality

**Depends on:** S4 accepted.

**Owned paths:**

- `packages/proto-tools/src/generation/generator.ts`
- Internal rejection-plugin files under
  `packages/proto-tools/src/generation/**`
- `packages/proto-tools/test/{proto-tools,external-consumer}.test.ts`
- `scripts/generate-rejections.mjs` and
  `scripts/generate-rejections.test.mjs` (remove or reduce to a single
  non-duplicated compatibility entry)
- `scripts/check-example-proto-quality.mjs`
- `scripts/check-example-proto-quality.test.mjs`
- `scripts/proto-workflow.mjs` and `scripts/proto-workflow.test.mjs`
- `examples/todo/buf.gen.custom.yaml` only to remove the Todo-only rejection
  plugin once generic generation owns it
- `build-protocol/example-proto-debt/*.json`

**Acceptance:**

- Every model-module `spine-proto generate` run emits typed throwable
  companions for top-level messages in owned `*rejections.proto` files.
- Companion TSDoc is deterministic, safely rendered, and derived from the
  message's leading Proto comment. It follows S1 formatting.
- Nested messages and frozen delivery-server rejections remain excluded as
  today. Output is same-directory, generated, ignored, and uncommitted.
- Packaged external-consumer generation works without a repository-only script
  or Todo-specific configuration.
- The example Proto checker rejects, for authored examples: missing separation
  between a declaration/field comment and the preceding field; packages not
  rooted at `spine.examples.<domain>`; any `v1` package/import/path component;
  a type URL prefix other than `type.spine.examples.<domain>`; missing or
  placeholder docs; and clearly unrelated framework/CQRS wording.
- The checker maps only the four accepted domains: `chat`, `projects`,
  `orders`, and `todo`. It permits noun-led documentation and exempts
  manifest-declared frozen copied sources.

**RED:** add synthetic model generation tests that currently omit a companion
and its Proto-comment TSDoc; add Proto fixture tests for adjacent fields/comments,
old singular namespace, `v1`, underscore/hyphen domains, wrong type prefix,
noun-led valid prose, framework jargon, and a frozen copied file.

**GREEN:** generic packed-model generation produces and typechecks the
companion; all checker fixtures classify correctly; the real repository scan
reports only S6/S7 owned migration debt.

**Focused gate:** rejection-generator, proto-tools packed/external-consumer,
example-Proto checker, and proto-workflow tests; focused package typecheck;
Proto lint/verify; TSDoc/format/generated-clean/diff checks.

**Review lanes:** style/maintainability, documentation, TypeScript/API docs,
and performance/reliability all required. Reliability covers deterministic
generation, subprocess/package behavior, atomic output, and duplicate-output
avoidance.

**Risk/exclusion:** high-risk generated contract. Do not add a public generator
API, change rejection runtime semantics, edit generated output, or broaden the
file-name convention beyond the existing top-level rejection rule.

## S6 — Merge Chat Models and Migrate the Chat Contract

**Depends on:** S5 generic generator and Proto rules fixed.

**Owned paths:**

- `examples/chat/model/**`
- `examples/chat/users-model/**` (remove after moving its one owned model)
- `examples/chat/app/**`
- `examples/chat/web/**`
- `examples/chat/README.md`
- Chat entries in `package.json`, `pnpm-lock.yaml`, `tsconfig.json`,
  `scripts/proto-workflow.mjs`, `scripts/proto-workflow.test.mjs`,
  `scripts/chat-family-migration.test.mjs`,
  `scripts/check-cleanup-rules.mjs`,
  `scripts/example-model-package-payload.test.mjs`, and
  `docs/check-typescript-snippets.mjs`

**Acceptance:**

- `examples/chat/model` is the only Chat model module. `UserId` and all Chat
  messages live under `spine.examples.chat` in
  `examples/chat/model/proto/spine/examples/chat/`, with no `v1`.
- Every Chat-owned type URL prefix is `type.spine.examples.chat`; imports,
  manifests, generated export paths, registry composition, tsconfig references,
  app/web consumers, fixtures, and docs use the new paths.
- The users-model workspace/package/dependency/config/clean target is removed.
  No replacement example or compatibility module is invented.
- `examples/chat/app/src/message-validation.ts` and its duplicate tests are
  removed. Invalid Chat signals are rejected through S4 using declared Proto
  validation options; unsupported handwritten byte limits disappear.
- `examples/chat/app/src/rejections.ts` is removed. Chat imports the generic
  generated `MessageAlreadyPosted` companion whose TSDoc comes from Proto.
- All Chat Proto message/field comments use Chat language and required blank
  separation.

**RED:** update/add migration assertions for exactly one Chat model; add
behavior tests showing invalid Chat command data is rejected before the handler
and duplicate posting throws the generated companion. First prove old imports,
manual validation, and manual rejection remain detectable.

**GREEN:** clean Chat generation, compose, handler generation, app tests, web
tests, model registry tests, package payload checks, and migration scans pass
with no `users-model`, old namespace, `v1`, or manual companion/validator.

**Focused gate:** Chat model/app/web tests and builds, generic generation tests,
Proto quality/lint, generated-clean, snippet checks, TSDoc/lint/format/diff.

**Review lanes:** all four specialist lanes required. TypeScript/API docs
reviews serialized paths and generated imports; reliability reviews validation
admission and generator use.

**Risk/exclusion:** high-risk serialized and topology migration with no
compatibility bridge. Do not create a second model or another example.

## S7 — Migrate Todo, Projects, and Orders Contracts and Paths

**Depends on:** S6, because root generation/workspace paths overlap.

**Owned paths:**

- `examples/todo/**`
- Rename `examples/project-management/**` to `examples/projects/**`
- Rename `examples/datastore-orders/**` to `examples/orders/**`
- Corresponding entries in `package.json`, `pnpm-lock.yaml`, `tsconfig.json`,
  `scripts/proto-workflow.mjs`, `scripts/proto-workflow.test.mjs`,
  `scripts/check-cleanup-rules.mjs`,
  `scripts/check-generated-clean.test.mjs`, and example/package payload tests
- Direct current-API references in `docs/USER_GUIDE.md` only when required to
  keep snippets compiling; general prose audit remains S10

**Acceptance:**

- Todo Proto lives at `proto/spine/examples/todo/**`, package
  `spine.examples.todo`, prefix `type.spine.examples.todo`, with no `v1`.
- Project Management's physical example directory is `examples/projects`;
  Proto lives at `proto/spine/examples/projects/**`, package
  `spine.examples.projects`, prefix `type.spine.examples.projects`.
- Datastore Orders' physical example directory is `examples/orders`; Proto
  lives at `proto/spine/examples/orders/**`, package
  `spine.examples.orders`, prefix `type.spine.examples.orders`.
- The private npm package identities need not be renamed merely because their
  directories move; only current references and deterministic assertions may
  change.
- Imports, generated paths, manifests, scripts, tsconfigs, load tests, topology
  tests, Todo rejection/entity-column generation, docs, and commands resolve
  from final paths.
- All authored Proto field spacing and domain-language rules pass. Frozen
  upstream Proto remains byte-identical to baseline.

**RED:** extend the Proto/path tests to enumerate all four accepted domains and
reject every old example directory, `spine.example`, `_management`,
`datastore_orders`, hyphenated type-prefix domain, or `/v1/` reference.

**GREEN:** clean generation/build/tests for Todo, Projects, and Orders pass from
final directories; repository owned-example scans find no old namespace/type
URL/path; copied-source verification proves frozen files unchanged.

**Focused gate:** each example's Proto module/load/topology or black-box suite;
Todo generic rejection and entity-column tests; Proto workflow/quality/lint;
generated-clean; workspace typecheck; TSDoc/lint/format/diff.

**Review lanes:** style/maintainability, documentation, and TypeScript/API docs
required; performance/reliability required for preserved load/topology behavior
and otherwise bounded to regression, not benchmark redesign.

**Risk/exclusion:** high-risk serialized/path migration. No compatibility
aliases, persisted-data migration, new example, or load-test semantics change.

## S8 — Make the Root Version Authoritative

**Depends on:** final workspace topology from S7.

**Owned paths:**

- Root `package.json`
- Every final `packages/*/package.json`
- Final example manifests:
  `examples/{todo,projects,orders}/package.json` and
  `examples/chat/{model,app,web}/package.json`
- `pnpm-lock.yaml`
- Tracked `spine-proto-manifest.json` files regenerated from those manifests
- `scripts/package-metadata.test.mjs` and narrowly related package/release
  metadata tests

**Acceptance:**

- Root version is exactly `2.0.0-snapshot.1`.
- All 21 final workspace modules (15 production packages and six private
  example modules) use that exact version.
- One deterministic test reads the root version as the sole expected value,
  enumerates the workspace patterns, and rejects any divergent/missing module
  version. It does not duplicate the snapshot string as a second policy value.
- Literal internal registry-version pins that currently use `0.0.0` converge
  to the root version; supported `workspace:*` links remain workspace links.
- Proto manifests, packed-package metadata, lockfile snapshots, and release
  checks agree after clean regeneration.

**RED:** mutate a fixture workspace version and the root version separately;
prove the checker rejects both divergence and a missing workspace. Prove the
current repository fails on `0.0.0`.

**GREEN:** metadata tests dynamically report the exact final workspace set and
all versions/pins/manifests agree with root.

**Focused gate:** package-metadata, proto manifest/model graph, pack/payload,
release-readiness and lockfile checks; workspace typecheck; generated-clean;
format/diff.

**Review lanes:** style/maintainability and TypeScript/API docs required for
package contract consistency; documentation required for version claims;
performance/reliability N/A because runtime behavior is unchanged.

**Risk/exclusion:** mechanical propagation after one root decision. Do not
publish, tag a release, change dependency ranges unrelated to internal
`0.0.0`, or answer Wave 5 packaging questions.

## S9 — Rewrite Every Production Package README and Add Agent References

**Depends on:** stable APIs, examples, paths, and versions from S8.

**Owned paths:**

- `packages/{core,proto,storage,transport,storage-datastore,storage-rdbms}/README.md`
  and matching new `REFERENCE.md`
- `packages/{server,delivery-server,delivery-client,proto-tools,testing}/README.md`
  and matching new `REFERENCE.md`
- `packages/{auth,client-node,client-web,client-react}/README.md` and matching
  new `REFERENCE.md`
- Documentation snippet/link checks only where needed to verify those files

Implement in the three groups above, serially, freezing a review-sized endpoint
after each group. Do not let separate writers edit the shared docs checks.

**Acceptance:**

- Each of all 15 `packages/*` modules has a beginner-oriented human README that
  explains what the module is for, teaches current supported workflows in plain
  language, and uses copyable current examples.
- Every README links to its sibling `REFERENCE.md` and explicitly says that the
  reference is documentation for agents.
- Each REFERENCE contains the detailed current technical contract, public
  entrypoints, guarantees, limits, lifecycle/error behavior where applicable,
  and no internal implementation-history narrative.
- Dense existing material is human-rewritten and assigned to the correct
  audience; it is not mechanically duplicated into both files.
- Snippets use public imports, current example paths, and supported behavior.
  No document promises excluded policy or leaks internal-only types.

**RED:** before each group, run link/snippet/API-prohibition and history-language
scans to capture missing REFERENCE links/files, stale imports, and unsupported
claims.

**GREEN:** the same checks pass for the group, practical snippets typecheck,
and README-to-REFERENCE links resolve.

**Focused gate:** docs/API checks, Markdown links, snippet compilation,
public-export/prohibition scans, TSDoc check, Prettier, and `git diff --check`.

**Review lanes:** documentation and TypeScript/API docs required for every
group; performance/reliability required for server/delivery/storage claims;
style/maintainability N/A unless a docs-check implementation changes.

**Risk/exclusion:** prose is non-mechanical. Do not expose internal APIs, copy
task logs, document future capability, or change production code to make a
snippet convenient.

## S10 — Audit All User-Facing Documentation and Close the Milestone

**Depends on:** S1-S9 accepted and all corrections applied.

**Owned paths:**

- User-facing tracked Markdown outside `build-protocol/**`, including root
  `README.md`, `docs/**/*.md`, `examples/**/*.md`, `interop/**/*.md`,
  `compatibility-tests/**/*.md`, package auxiliary READMEs, and repository
  research/reference Markdown intended for readers
- S9 package README/REFERENCE files only for cross-document reconciliation
- `docs/check-typescript-snippets.mjs`, Markdown-link/release-readiness checks,
  and narrowly related tests
- T-0082 task/work/review/decision/completion records only after production,
  examples, and public docs are stable

`AGENTS.md`, build-protocol historical records not explicitly assigned to the
orchestrator, protected files, and frozen upstream material are excluded from
the user-facing rewrite.

**Acceptance:**

- Every user-facing Markdown file is reviewed, not merely regex-rewritten.
  Internal execution-history language is removed: Wave labels, task IDs,
  phases, slices, milestones, candidates, promotions, and equivalent
  implementation chronology. Domain uses such as Todo “task” are not
  misclassified as task IDs.
- Commands, package names, paths, type URLs, imports, snippets, behavior claims,
  links, and audience statements match final code and generated contracts.
- No old example directory, `spine.example`, old type prefix, `v1` owned-example
  path, `users-model`, `0.0.0`, handwritten Chat validator, or handwritten Chat
  rejection companion remains in a user-facing surface.
- All old TSDoc/example-Proto debt files are absent or empty by a documented
  checker contract; no generated file is tracked; frozen upstream Proto is
  unchanged from baseline.
- Final branch coverage is at least 90%.

**RED:** run the repository history-language, Markdown link, snippet, version,
old namespace/path, generated-tracking, and public-API scans before edits and
record each real user-facing failure. Run focused behavior tests for any
cross-slice reconciliation defect.

**GREEN/final mechanical gate:**

```bash
pnpm exec vitest run \
  scripts/check-tsdoc.test.mjs \
  scripts/check-example-proto-quality.test.mjs \
  scripts/generate-rejections.test.mjs \
  scripts/package-metadata.test.mjs
node scripts/check-tsdoc.mjs
node scripts/check-example-proto-quality.mjs
pnpm --config.verify-deps-before-run=false proto:verify
pnpm --config.verify-deps-before-run=false proto:generate
pnpm --config.verify-deps-before-run=false typecheck:generated
pnpm --config.verify-deps-before-run=false docs:check:generated
pnpm --config.verify-deps-before-run=false proto:check-generated
pnpm --config.verify-deps-before-run=false check:release-readiness
pnpm --config.verify-deps-before-run=false verify
git diff --check
```

Also run exact tracked-file scans for all prohibited old example names/paths,
all workspace versions, package README/REFERENCE pairs, user-facing history
language, generated tracking, frozen Proto changes, and protected-file absence
from the diff.

**Review lanes:** run one complete final wave over the reconciled T-0082
endpoint: style/maintainability, documentation, TypeScript/API docs, and
performance/reliability. Run the final security reviewer because validation
and deserialization-to-handler admission changed. Aggregate the complete wave,
return one correction batch, rerun affected checks/lanes only, then run the
full final gate once after convergence.

**Integration order and closure:**

1. Freeze and record the verified task endpoint; reconcile every ledger item,
   slice endpoint, review disposition, and verification result.
2. Commit only after review convergence and the final gate.
3. Merge the T-0082 branch into current `main` without staging unrelated files.
4. Prove tree equality. Because shared build/generation infrastructure and
   serialized contracts changed, run post-merge full verification unless the
   orchestrator records protocol-sufficient evidence that the exact merged
   tree is the already verified tree and no mainline movement/conflict occurred.
5. Push the completed task branch and updated `main`; prove local/remote refs
   match. Push only an explicitly assigned tag.
6. Remove the worktree only when Git reports it clean and merged.

## Final Exclusions

T-0082 does not add a runtime feature beyond framework-owned validation, answer
Wave 5/6 questions, publish to npm, provide persisted compatibility migration,
rename frozen upstream packages, create another example, add multi-model
demonstration scaffolding, preserve invented Chat byte limits, redesign
transactions/delivery, or introduce speculative public APIs.
