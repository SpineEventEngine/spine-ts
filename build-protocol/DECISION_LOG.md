# Decision Log

Navigation: [README](README.md)

Future implementation must append every decision here or to a task-specific decision file linked from here.

## D-0044: T-0009e entity bases start as scoped OOP state shells

Status: Accepted

Date: 2026-06-29

Context: The roadmap now reaches `T-0009e Concrete OOP Entity Base Classes
With Capability Segregation`. `T-0009d.2` already provides an
`EntityTransaction` draft/result kernel, handler metadata exists, and
repositories/storage dispatch are still later tasks. Spine JVM `Entity`,
`AbstractEntity`, `TransactionalEntity`, `Aggregate`, `Projection`, and
`ProcessManager` show the desired conceptual shape, but most JVM behavior is
repository or dispatch owned.

Decision: Start entity base classes as small OOP state shells that expose
identity, state snapshots, version metadata, lifecycle flags, and scoped
transaction-backed draft mutation for future runtime callers. Do not implement
repository ownership, handler invocation, event sourcing history, dispatch
phases, idempotency, query clients, Bounded Context injection, lifecycle events,
storage writes, buses, gRPC, or ZeroMQ in the first `T-0009e` slice. Family
classes such as `Aggregate`, `Projection`, and `ProcessManager` may exist as
typed capability markers only if the splitter keeps them shallow and verifies
they do not pretend to dispatch.

Alternatives considered:

- Build full aggregate/projection/process-manager dispatch now. Rejected
  because repositories, buses, event history, and storage integration are later
  roadmap items and would over-invent the server module.
- Keep only standalone transaction helpers and delay entity classes entirely.
  Rejected because the developer API needs familiar OOP base-class shapes before
  repository seams can bind metadata, handlers, and transactions.
- Model JVM builders directly. Rejected because Protobuf-ES uses message
  values and schemas rather than generated Java builders; TS should use
  explicit transaction draft updates while preserving the conceptual boundary.

Consequences:

- Reviewers must reject any first-slice entity base behavior that silently
  invokes handlers, stores state, posts signals, or exposes transport/runtime
  details.
- Public docs must be explicit that these bases are local OOP/domain shells and
  future repository/runtime consumers own persistence and dispatch.
- The splitter must stage any family-specific restrictions, event-sourced
  aggregate behavior, or process-manager querying separately.

## D-0043: T-0009d.2c closes the transaction API without runtime expansion

Status: Accepted

Date: 2026-06-29

Context: `T-0009d.2a` introduced the minimal `EntityTransaction` draft/commit
kernel, and `T-0009d.2b` added lifecycle and explicit version draft helpers.
The remaining splitter item, `T-0009d.2c Public API Polish, Compatibility
Notes, Verification Closure`, should make the series interruption-resistant and
clear to users without adding behavior that belongs to later repository,
entity-base, dispatch, storage, or transport tasks.

Decision: Treat `T-0009d.2c` as a public API compatibility and verification
closure. It may update parent task/work logs, user/API/architecture docs,
TypeDoc wording, export-gate expectations, and tests that assert the existing
public surface. It must not add new transaction runtime capabilities unless a
concrete compatibility defect is discovered, the corresponding Spine JVM
`core-jvm/server` code is inspected, and a new decision is recorded. The
default implementation path is docs, compatibility notes, API assertions, and
verification evidence.

Alternatives considered:

- Add the next runtime layer now, such as entity base classes or repository
  commit integration. Rejected because the splitter scoped this final item as
  public API polish and verification closure, and the human asked to avoid
  over-inventing server behavior.
- Add convenience helpers proactively before entity bases exist. Rejected
  because D-0040 through D-0042 keep the transaction kernel deliberately small
  until concrete runtime consumers prove the API gap.
- Skip the closure because `2a` and `2b` already pass verification. Rejected
  because parent roadmap logs and public compatibility notes must stay durable
  and clear before the next server task builds on this API.

Consequences:

- Reviewers for `T-0009d.2c` must flag any new runtime behavior as out of
  scope unless it is tied to a recorded compatibility defect and JVM source
  inspection.
- Public docs should describe `EntityTransaction` as a JVM-familiar in-memory
  draft/result boundary, not storage-backed transaction infrastructure.
- Completion requires fresh branch verification and main integration
  verification evidence.

## D-0042: T-0009d.2b lifecycle and version helpers are draft metadata only

Date: 2026-06-29

Context: `T-0009d.2b` follows the minimal `EntityTransaction` kernel with
small lifecycle and explicit version draft helpers. Spine JVM `Transaction`
buffers `LifecycleFlags` and exposes `setArchived()` / `setDeleted()` only
inside an active transaction. JVM version increments are tied to
`VersionIncrement` and dispatch phases, which are not implemented in this TS
slice.

Decision: Add only draft metadata helpers in `@spine-ts/server` for lifecycle
flags and caller-owned version metadata. Lifecycle helpers may set `archived`
or `deleted` flags on the in-memory transaction draft, and `requireActive()`
may guard active-only mutation based on those draft flags. Version helpers may
replace explicit draft metadata supplied by the caller. The framework will not
invent automatic increments, clocks, event versions, lifecycle events,
repository filtering, storage writes, entity records, or dispatch-phase
semantics in this task.

Alternatives considered:

- Implement JVM-style `VersionIncrement` now. Rejected because event/command
  dispatch phases and event version policy are not available yet.
- Emit lifecycle events or diagnostics from helpers. Rejected because storage,
  entity records, lifecycle monitors, and buses are out of scope.
- Treat archived/deleted flags as read-side filtering behavior. Rejected
  because read-side query semantics belong to repository/storage/query tasks.

Consequences:

- The public helper names stay familiar to Spine JVM users without claiming
  persistence/runtime behavior.
- Later entity base classes can call these helpers inside framework-controlled
  handling transactions.
- Later runtime tasks must define how version increments and lifecycle
  diagnostics are produced before storage/dispatch integration.

## D-0041: T-0009d.2a validation-rejected commits leave the draft transaction active

Date: 2026-06-29

Context: `T-0009d.2a` adds the minimal `EntityTransaction` draft/result kernel.
The task requires ordinary validation failures to return rejected commit results
with validator violations and not throw. It also requires deterministic rejection
of `update()` and `commit()` after commit or rollback, but does not specify that
a validation-rejected commit attempt releases the transaction.

Decision: A validation-rejected `commit()` returns `status: "rejected"` with
the previous state, rejected draft, version metadata, lifecycle flags, and
validator result, while keeping the transaction `status` as `"active"`.
Accepted commits set transaction status to `"committed"`; rollback sets it to
`"rolled-back"`.

Consequences:

- Framework/runtime code can inspect validator violations and decide whether to
  update the draft again, roll back, or surface the rejection.
- The minimal transaction status union remains the D-0040 set:
  `"active" | "committed" | "rolled-back"`.
- Future repository/handler slices may add stricter caller policy without
  changing the structured rejected commit result.

## D-0040: T-0009d.2 server transaction kernel stays smaller than runtime

Date: 2026-06-29

Context: T-0009d.2 starts the entity transaction layer after built-in
`(set_once)` transition validation. The human specifically warned that
`@spine-ts/server` work should closely inspect Spine JVM `core-jvm/server` and
avoid over-inventing. Task-relevant JVM code shows `Transaction` as a buffered
draft over entity state, version, and lifecycle flags, injected into a
`TransactionalEntity`, validated at commit, and released after commit or
rollback. It also owns dispatch phases and entity mutation in JVM, but those
runtime concerns are larger than this TS slice.

Decision: Implement only a small TypeScript transaction draft/result kernel in
this task. It may expose an explicit draft/update API, active/committed/rolled
back status, lifecycle/version draft data, commit-time state transition
validation through `validateEntityStateTransition()`, and structured commit
results. It must not implement repositories, storage writes/reads, handler
dispatch, dispatcher phases, recent history, buses, gRPC, ZeroMQ, worker
processes, or transport adapters.

Alternatives considered:

- Implement a full JVM-like `Transaction` with dispatch phases now. Rejected
  because handler invocation, repositories, and storage are not ready, and this
  would overfit unimplemented runtime behavior.
- Keep only the existing pure `validateEntityStateTransition()` API. Rejected
  because the next server slice needs a framework-owned commit boundary that
  future entity base classes can consume.
- Use implicit global or async-local transaction state. Rejected for this slice
  because the JVM model exposes explicit transaction ownership and the TS spec
  prefers explicit parameters for Node async safety.

Consequences:

- Future `Aggregate`, `Projection`, and `ProcessManager` base classes can build
  on a small validation-backed transaction boundary.
- Later runtime tasks may add repository integration and dispatch phases without
  breaking this public kernel.
- Reviewers should reject speculative transport/storage/dispatch behavior in
  this task even if it resembles later JVM responsibilities.

## D-0001: Documentation-only scope for current task

Answer from human: create documentation/specifications only now. Do not create package skeletons or implementation code.

## D-0002: New folder name

Answer from human: use `build-protocol` as the new root folder for this specification set.

## D-0003: Spine Protobuf files

Answer from human: required Spine Protobuf files must be copied into the TS framework implementation. The specification records this as a compatibility requirement; actual copying happens during implementation.

## D-0004: Compatibility target

Answer from human: no source-level compatibility with Spine JVM is required, but the TS framework should be conceptually familiar to Spine JVM users.

## D-0005: Handler declaration

Answer from human: use TypeScript decorators if they fit, and use the latest mature TypeScript decorator specification. The spec therefore targets TypeScript 5+ standard decorators and requires fallback/codegen investigation.

## D-0006: Custom code generation

Answer from human: whether custom code generation is required is an investigation decision. The spec defines the generated/runtime metadata contract but does not prescribe the generation mechanism.

## D-0007: ZeroMQ scope

Answer from human: ZeroMQ is only for local IPC signal transfer. Scaling beyond one host should use another transport behind the abstraction.

## D-0008: Bus topology

Answer from human: choose topology based on bus needs; buses have publishers and subscribers, and pub/sub appears natural. The spec uses pub/sub where appropriate but allows other ZeroMQ patterns inside the adapter for command/query semantics.

## D-0009: gRPC service contracts

Answer from human: keep Spine JVM gRPC interfaces, especially `CommandService`, `QueryService`, and `SubscriptionService`; sync/async behavior follows their definitions.

## D-0010: To-do example timing

Answer from human: the spec must require a standalone to-do example app, but details remain light until the framework shape is defined.

## D-0011: Build protocol execution environment

Answer from human: the build protocol will be executed in Codex on macOS with sub-agents available.

## D-0012: Human questions

Answer from human: stop on blocking questions. For non-blocking questions, spawn advisory sub-agents, have them propose/vote, record the result, and continue.

## D-0013: Tooling choices

Answer from human: define selection criteria now and defer exact choices.

## D-0014: Review coverage

Answer from human: every task, including documentation tasks, must receive code style, documentation, TS docs, security, and performance reviews.

## D-0015: Required docs from start

Answer from human: ADRs, package-level READMEs, and API references are required from the start; architecture diagrams are not required from the start.

## D-0016: Initialize implementation repository before first task branch

Date: 2026-06-27

Context: The implementation workspace initially contained the build protocol and JVM research documents but was not a Git repository. The build protocol requires one feature branch and one worktree per coding task/sub-task.

Decision: Initialize this workspace as a Git repository, commit the existing specification and bootstrap logs as the baseline, then create task-specific feature branches and worktrees from that baseline.

Alternatives considered:

- Treat the absence of Git as a blocking human question. Rejected because the user explicitly requested immediate autonomous progress and branch/worktree execution is part of the protocol.
- Use temporary directories without Git branches. Rejected because it would violate the protocol and make interruption recovery weaker.

Consequences:

- The initial repository history starts from the provided specification corpus plus the autonomous-process bootstrap logs.
- Task implementation branches are traceable from the first durable baseline commit.

## D-0017: Reusable governance templates without duplicated quality rules

Date: 2026-06-27

Context: T-0001 creates durable task, work-log, review-log, question-log, and decision templates before runtime implementation begins. Future agents need consistent files for resumability, but the repository already has `build-protocol/CODE_QUALITY.md` as the seed for authoritative quality rules.

Decision: Add reusable governance templates under `build-protocol/templates/` and contributor workflow notes in `build-protocol/CONTRIBUTOR_WORKFLOW.md`. Templates must link to `BUILD_PROTOCOL.md` and `CODE_QUALITY.md` for gates, quality rules, and reviewer expectations instead of copying those rules into each template.

Alternatives considered:

- Copy quality gates into every template. Rejected because copied rules drift and violate the non-duplication rule.
- Defer templates until implementation code exists. Rejected because the build protocol requires durable logs before or alongside changes and reviewer loops need a stable scaffold.

Consequences:

- Future task agents can start from a consistent logging shape.
- Reviewers can verify resumability and protocol compliance without comparing several duplicated quality-rule files.
- Any future rule changes should be made in the authoritative protocol or quality documents, then referenced from templates as needed.

## D-0018: Canonical governance paths and redacted logs

Date: 2026-06-27

Context: Review round 1 for T-0001 found that task logs could drift into parallel path shapes and unresolved-question references could imply lowercase/uppercase aliases. The same review asked for audit-friendly governance logs that do not commit sensitive values.

Decision: Use `build-protocol/tasks/<task-slug>/TASK.md` as the canonical task-log path for new tasks, matching the existing bootstrap records. Use only `build-protocol/questions/UNRESOLVED.md` for unresolved questions. Governance logs and templates must record enough evidence for auditability while redacting tokens, credentials, auth headers, secret environment variables, sensitive local paths, and sensitive payloads.

Alternatives considered:

- Allow both flat task files and directory-style task records. Rejected because it creates parallel shapes for future agents.
- Treat a case-only unresolved-questions path variant as an alias. Rejected because case-only ambiguity is fragile on macOS.
- Log raw command outputs and payloads for maximum evidence. Rejected because audit logs must not commit secrets or sensitive local data.

Consequences:

- Future tasks have one obvious task-log location.
- Reviewers can check unresolved questions in a single canonical file.
- Logs should preserve decisions, command names, and outcomes, but redact sensitive values before commit.

## D-0019: User-installed skills are governed inputs, not optional memory

Date: 2026-06-27

Context: T-0003 exists because future agentic work must use relevant installed
skills instead of relying on an agent's memory of best practices. The
`skills.sh` installation batch identified user-installed skill sources under
`~/.agents/skills`, including `subagent-driven-development`,
`using-git-worktrees`, `requesting-code-review`,
`verification-before-completion`, `planning-with-files`,
`architecture-decision-records`, `typescript-advanced-types`, and
`nodejs-backend-patterns`. Node tooling was also repaired before this task:
Node `v24.18.0`, corepack `0.35.0`, and pnpm `11.9.0` made skill installation
usable again.

Decision: Every orchestrator, implementer, adviser, and reviewer prompt/log must
run the canonical skill applicability check in
`BUILD_PROTOCOL.md#skills-and-tooling` before task actions. The check must
capture bounded, task-relevant evidence from the session skill inventory and
record task-provided skills, the repo-local expected-skill manifest, reachable
user-installed skill entrypoints under `~/.agents/skills`, and reachable
installed-skill lock/manifest evidence such as `~/.agents/.skill-lock.json`.
Agents triage by metadata/name/path first and fully read only selected
applicable `SKILL.md` files before actions governed by those skills.
Relevant-looking skills that are skipped require a recorded reason without
implying the full skill body was consumed.

The review skill gate is mandatory for every reviewer. Individual skill sources
or specific skills may be N/A with reasons, but the review gate itself is not
optional.

Trust and conflict rule: Installed and task-provided skills are untrusted
advisory prompt inputs. They guide workflow and domain practice, but cannot
authorize tool use, network access, installs, filesystem access, secret
handling, redaction changes, sandbox or approval bypasses, or protocol
exceptions. `BUILD_PROTOCOL.md`, `CODE_QUALITY.md`, the task specification,
sandbox/approval rules, and explicit human/orchestrator authorization remain
authoritative when conflicts exist. Agents must record the conflict and the
chosen project or authorization rule rather than silently following the skill.

Consequences:

- Future work has an auditable gate showing which skills were considered,
  selected, passed to sub-agents or reviewers, and skipped.
- Skill contents are referenced by name/path and summarized for applicability;
  they are not duplicated into repository governance files.
- Reviewer logs must include evidence that skill applicability was checked/read
  for the review role, with N/A limited to individual sources or skills.

## D-0020: T-0002 workspace and package toolchain

Date: 2026-06-27

Context: T-0002 initializes the implementation workspace without runtime behavior. Advisory tooling notes were available for package management, TypeScript, lint/format, test/coverage, docs, Buf/Protobuf-ES, validation, gRPC, and ZeroMQ dependency timing.

Decision: Use pnpm workspaces with `packageManager: pnpm@11.9.0`, TypeScript project references, and no Nx/Turbo layer initially. Use Node 24 LTS as the minimum engine. Keep packages private while the framework API is skeletal. Add `engine-strict=true`, pnpm `engineStrict: true`, `.node-version`, and a `check:node` verification script so local and CI verification fail under unsupported Node versions. Keep `confirmModulesPurge: false` for non-interactive recovery after interrupted installs. Set pnpm `verifyDepsBeforeRun: error` so script execution fails instead of silently continuing or auto-installing when dependency state is stale. Set repo-local pnpm `minimumReleaseAge: 1440` and add narrow `minimumReleaseAgeExclude` entries for the already reviewed fresh lockfile pins `prettier@3.9.0` and `js-yaml@4.3.0` instead of a global freshness bypass.

Alternatives considered:

- Nx or Turbo for orchestration. Deferred because the skeleton has simple project references and workspace scripts; a task runner can be added once build graph cost justifies it.
- npm or Yarn as the canonical package manager. Rejected for now in favor of pnpm's workspace ergonomics and deterministic lockfile behavior.

Consequences:

- Root scripts call the standard pnpm workspace toolchain directly.
- One-time release-age policy exceptions were used while creating/updating the lockfile because the task explicitly pinned fresh packages, including `prettier@3.9.0`; the broad bypass is not retained as a repo default, and the repo now enforces release-age protection with explicit package/version exclusions for reviewed fresh pins.
- Non-interactive runs avoid TTY purge prompts after interrupted installs.
- Normal installs are subject to the repo-local release-age policy; scripts also keep pnpm's dependency-state pre-run verification enabled in fail-fast mode.
- Verification explicitly checks Node major version before TypeScript, lint, tests, docs, or proto stubs run.
- Reviewers should revisit task-runner adoption only after package graph complexity or CI time makes it useful.

## D-0021: T-0002 TypeScript and module target

Date: 2026-06-27

Context: The framework is ESM-first and targets modern Node.js. Advisory notes recommended TypeScript 6.0.3 with NodeNext and strict settings.

Decision: Pin `typescript@6.0.3`, configure ESM-first `NodeNext`, and enable modern strict compiler settings in `tsconfig.base.json`. Keep a documented fallback to TypeScript 5.9 if compatibility with released dependencies fails in a later verification or review task.

Alternatives considered:

- TypeScript 5.9 immediately. Deferred because advisory guidance selected 6.0.3 and the task should start from the intended current compiler.
- CommonJS output. Rejected because the framework and selected ecosystem are ESM-first.

Consequences:

- Package source imports use NodeNext-compatible `.js` specifiers.
- Later runtime tasks must preserve explicit public API types and TypeDoc comments.

## D-0022: T-0002 linting, formatting, testing, coverage, and API docs

Date: 2026-06-27

Context: The repository needs quality gates from the start without duplicating `CODE_QUALITY.md`. Advisory notes recommended ESLint flat config, `typescript-eslint@8.62.0`, Prettier 3.9.0, Vitest 4.1.9, V8 coverage, and TypeDoc 0.28.19.

Decision: Use ESLint flat config with `typescript-eslint@8.62.0`, `eslint-config-prettier`, Prettier 3.9.0, Vitest 4.1.9 with `@vitest/coverage-v8@4.1.9`, and TypeDoc 0.28.19 native HTML output. Configure 90% coverage thresholds for the current skeleton exports and future meaningful source. Defer `typedoc-plugin-markdown`. Format durable repository areas, including future `build-protocol/**/*.md` task/review/log files, while ignoring pre-existing unformatted protocol files until a dedicated formatting cleanup owns that churn. Add `@types/node@24.13.2` and a no-emit tooling/test/config TypeScript check so Vitest config and test files are typechecked in addition to package project references.

Alternatives considered:

- Biome or Oxlint as primary lint/format tooling. Rejected/deferred because ESLint plus typescript-eslint gives mature type-aware rules for this bootstrap.
- TypeDoc Markdown output. Deferred because native HTML is canonical for now and avoids another plugin dependency.

Consequences:

- Generated docs output lives under `docs/api/reference` and is ignored by Git.
- The current coverage gate is satisfied by metadata-only skeleton tests; future tasks must add behavior-level tests as runtime code appears.
- `pnpm typecheck` runs both `tsc -b` for package source builds and `tsc --noEmit -p tsconfig.eslint.json` for tests/config/tooling TS.
- TypeDoc currently emits one warning because the local `origin` remote is not valid for source links; HTML generation still succeeds with zero errors.

## D-0023: T-0002 Buf and Protobuf-ES bootstrap

Date: 2026-06-27

Context: The technical spec requires Buf and Protobuf-ES, but T-0002 must not copy Spine proto files. Advisory notes recommended current Buf/Protobuf-ES package versions and v2 config stubs.

Decision: Install `@bufbuild/buf@1.71.0`, `@bufbuild/protobuf@2.12.1`, and `@bufbuild/protoc-gen-es@2.12.1`. Add `buf.yaml` and `buf.gen.yaml` v2 stubs with `target=ts`, `import_extension=js`, and local `protoc-gen-es`. Add a proto workflow script that exits successfully with an explicit deferred message while `proto/` contains no `.proto` files. Approve only `@bufbuild/buf` in pnpm `onlyBuiltDependencies`, because pnpm flagged its postinstall build script during verification.

Alternatives considered:

- Copy Spine proto files during T-0002. Rejected because proto intake is out of scope for this task.
- Use `ts-proto`, `protobuf.js`, or hand-written bindings. Rejected by the Protobuf contract.

Consequences:

- `pnpm proto:lint` and `pnpm proto:generate` are realistic commands now and become real Buf invocations after proto intake.
- Generated Protobuf-ES output is expected under `packages/proto/src/generated` and is excluded from lint, coverage, and docs.

## D-0024: T-0002 deferred runtime dependencies and skill-install attempt

Date: 2026-06-27

Context: Advisory notes covered validation, gRPC, ZeroMQ, and Codex skills. T-0002 owns tooling only and must not implement runtime adapters or services.

Decision: Do not install `@spine-event-engine/validation-ts`, Connect/gRPC packages, or `zeromq` in T-0002. Record validation-ts as mandatory but deferred to the validation/proto task; current advisory note: latest `2.0.0-snapshot.1`, snapshot `2.0.0-snapshot.4`, peer `@bufbuild/protobuf ^2.10.2`. Prefer Connect-ES v2 candidates in the future server service-contract task, with `grpc-js` fallback only. Prefer `zeromq@6` in the future transport adapter task, deferred because it introduces native addon/runtime scope.

Also record that skills listing was repeated via `skill-installer` and failed with GitHub HTTP 401; no skill was installed and the failure is non-blocking for T-0002.

Alternatives considered:

- Install validation, gRPC, and ZeroMQ dependencies immediately. Rejected because that would widen T-0002 into runtime scope and make native/runtime verification premature.
- Treat the skills-listing failure as blocking. Rejected because the task has enough explicit advisory input and no required skill was available.

Consequences:

- Runtime dependency selection remains auditable without adding unused packages.
- Later validation, service-contract, and transport tasks must pin and smoke test their own dependencies when they enter scope.

## D-0025: T-0004 proto intake uses exact researched Spine source commits

Status: Accepted

Context: `PROTOBUF_CONTRACT.md` requires copied Spine JVM `.proto` files to be
preserved as canonical contracts, beginning with `spine/options.proto`, while
T-0002 intentionally deferred proto intake. The JVM research corpus records the
source baseline and commit IDs used for Spine 2.0.0-series behavior. The actual
proto files are not present in this repository, so T-0004 needs reproducible
upstream provenance before copying or generating any contracts.

Decision: T-0004 will copy proto files verbatim from exact GitHub raw URLs at
the researched commits recorded in `spine-jvm-docs/README.md`, starting with:

- `SpineEventEngine/base` commit
  `43b55858c410eaf79fc594ca6f3f3eab0daca027` for `spine/options.proto`
  and base/string transitive dependencies.
- `SpineEventEngine/validation` commit
  `6aec690168182866876584dab7c5a0b220b9b493` for
  `spine/validation/validation_error.proto`.
- `SpineEventEngine/time` commit
  `0d0251c1495f4dc5a383ef2d6b8b2a0e405a327d` only if the T-0004 minimal
  intake includes `spine/time_options.proto` or time message dependencies.

T-0004 must add a manifest or verification mechanism that records source
repository, full commit, upstream path, canonical source/raw URLs, local path,
and a checksum for each copied file. The default verification remains
network-free: it validates the manifest shape, copied file set, safe local
paths, and local SHA-256 checksums rather than fetching upstream on every run.
Buf and Protobuf-ES generation remain the only supported TypeScript generation
path.

Alternatives considered:

- Copy from local `/private/tmp/spine-research` clones. Rejected because those
  clones are not present in this workspace and would weaken reproducibility for
  interruption recovery.
- Track upstream default branches. Rejected because that could silently change
  Protobuf contracts and break compatibility with the researched JVM baseline.
- Rewrite a smaller local `options.proto`. Rejected by the Protobuf contract and
  the user instruction to preserve Spine definitions.

Consequences:

- Proto compatibility is tied to a stable, reviewable JVM research baseline.
- Network is required for the first intake or future drift checks unless files
  are already vendored locally.
- Future tasks may add more Spine proto sources from `core-jvm`, `time`,
  `change`, or other baseline repos, but each addition must extend the manifest
  rather than editing copied definitions by hand.

## D-0026: Pin pnpm local virtual-store behavior for reproducible verification

Status: Accepted

Date: 2026-06-28

Context: The workspace requires `verifyDepsBeforeRun: error` so scripts do not
run against stale dependency metadata. After Node and Corepack were repaired,
the Codex shell initially resolved an app-bundled `pnpm@11.7.0` while the
project pins `pnpm@11.9.0`. Reinstalling with Corepack fixed the package-manager
metadata, but `CI=true pnpm verify` still rejected the tree unless the
global-virtual-store setting matched the install command.

Decision: Pin `enableGlobalVirtualStore: false` in `pnpm-workspace.yaml` and use
Corepack so the project-pinned `pnpm@11.9.0` runs installs and verification.

Alternatives considered:

- Disable `verifyDepsBeforeRun`. Rejected because it would weaken the
  interruption-resistant verification guard established for the workspace.
- Require every verification command to pass
  `--config.enable-global-virtual-store=false`. Rejected because it is easy for
  future agents to forget and leaves the project dependent on shell history.
- Edit `node_modules/.modules.yaml` by hand. Rejected because install metadata
  should be owned by pnpm, not manually patched.

Consequences:

- `CI=true corepack pnpm verify` can compare dependency metadata against an
  explicit workspace setting instead of an ambient pnpm default.
- Future local installs should use Corepack or another pnpm `11.9.0`
  executable to respect `packageManager`.
- If the project later adopts pnpm's global virtual store intentionally, that
  decision must update this record and rerun install plus full verification.

## D-0027: Put the first runtime type registry in `@spine-ts/core`

Status: Accepted

Date: 2026-06-28

Context: T-0005 introduces the metadata and type registry layer over
Protobuf-ES schemas. The registry is runtime behavior: it owns lookup semantics,
duplicate registration policy, type URL derivation, and later metadata access
for validation and routing. The `@spine-ts/proto` package currently owns copied
Spine contracts, generated Protobuf-ES output, and curated generated exports.

Decision: Implement the first registry slice in `packages/core` and consume
curated exports from `@spine-ts/proto`. Keep `@spine-ts/proto` focused on
canonical generated contracts and generated-schema availability. Use explicit
manual registration for the current curated Spine schemas in this first slice.

Alternatives considered:

- Put the registry in `@spine-ts/proto`. Rejected because that would mix
  generated-contract ownership with runtime lookup policy and make later
  validation/runtime dependencies leak into the proto package.
- Create a new package only for metadata. Deferred because the current
  workspace already has `@spine-ts/core` for core runtime concepts and the
  first registry surface is small enough to belong there.

Consequences:

- Runtime users import registry APIs from `@spine-ts/core`.
- `@spine-ts/core` may depend on `@spine-ts/proto`, but generated packages do
  not depend on runtime packages.
- If the registry grows into a large independent compatibility layer, a future
  decision may split it into a dedicated package without changing the
  generated-contract boundary.

## D-0028: T-0005 registry lookup and type URL policy

Status: Accepted

Date: 2026-06-28

Context: T-0005 needs deterministic lookup semantics before runtime envelopes,
validation, or `Any` unpacking exist. The Protobuf contract requires mappings
between full names, type URLs, schemas, and semantic tags. Current copied Spine
proto files expose type URL prefixes and option definitions but only a small
message closure.

Decision: The first registry will derive canonical type URLs as
`<file type_url_prefix>/<schema.typeName>` when a file option supplies a prefix,
with `type.googleapis.com` as the documented fallback prefix used only for
files without the option.
Registration fails fast on duplicate full names, duplicate type URLs, or
conflicting schema identities. Public lookup APIs include throwing `get*`
methods and non-throwing `find*` methods, so callers can choose fail-fast or
optional control flow explicitly.

Alternatives considered:

- Overwrite duplicates like a plain map. Rejected because silent replacement can
  corrupt routing and validation decisions.
- Return only `undefined` for misses. Rejected because framework internals need
  descriptive failures when required message types are missing.
- Implement `Any` pack/unpack helpers immediately. Deferred to later envelope
  and validation tasks; T-0005 only supplies the registry lookup foundation.

Consequences:

- Runtime code can use fail-fast lookups while tests and optional flows can use
  `find*` methods.
- Duplicate registration tests become part of the compatibility guard.
- A later task must revisit semantic tag registration once copied proto fixtures
  include real `(is)` or `(every_is)` consumers.

## D-0029: Wrap `@spine-event-engine/validation-ts` behind the core validation facade

Status: Accepted

Date: 2026-06-28

Context: T-0006 introduces message validation. The Protobuf contract mandates
`@spine-event-engine/validation-ts` for single-message validation and reserves
stateful rules such as `(set_once)` for the framework transaction/runtime layer.
Current npm metadata checked on 2026-06-28 reports package versions
`2.0.0-snapshot.1`, `2.0.0-snapshot.3`, and `2.0.0-snapshot.4`; dist-tags
`latest = 2.0.0-snapshot.1` and `snapshot = 2.0.0-snapshot.4`; peer dependency
`@bufbuild/protobuf ^2.10.2`. The project currently uses
`@bufbuild/protobuf 2.12.1`, which satisfies the peer range. The published
snapshot README says the package API is experimental and recommends installing
the `snapshot` dist-tag.

Decision: Add `@spine-event-engine/validation-ts` to `@spine-ts/core` as an
exact `2.0.0-snapshot.4` dependency for T-0006, because that is the current
snapshot dist-tag and matches the project's Buf/Protobuf-ES stack. Do not expose
`validation-ts` imports as the framework API. Instead, wrap its public
`validate(schema, message)` and violation helpers behind a small
`@spine-ts/core` facade that returns structured Spine validation data and offers
a throwing check path. Keep framework transition validation, including
`(set_once)`, separate from single-message validation.

Alternatives considered:

- Use the npm `latest` dist-tag (`2.0.0-snapshot.1`). Rejected because the
  package README directs users to the `snapshot` dist-tag and `snapshot.4` is
  newer while remaining peer-compatible.
- Reimplement Spine validation rules in T-0006. Rejected because it violates
  the non-negotiable requirement to use `validation-ts` for single-message
  validation and would duplicate a common infrastructure library.
- Depend on a generic Protobuf validator or non-Buf generator runtime. Rejected
  because current library search did not find a Spine-options-compatible
  alternative, and generic protobuf stacks conflict with the Buf/Protobuf-ES
  contract.

Consequences:

- The framework can absorb `validation-ts` API churn by adjusting one adapter
  instead of changing user imports.
- T-0006 tests must exercise the facade behavior, not the upstream package
  internals.
- Future dependency updates must re-check the npm dist-tags, peer dependency,
  and exported declarations before changing the exact package version.

## D-0030: Core Signal Proto Intake Before Envelope Helpers

Status: Accepted

Date: 2026-06-28

Context: T-0007 needs command/event envelope and actor/tenant/version context
support. The current repository only contains the earlier proto intake set for
options, field paths, template strings, and validation errors. High-level
TypeScript envelope helpers would otherwise need to invent local shapes or
partial hand-written contracts.

Decision: Implement T-0007 as a proto-first sequence. T-0007a copies and
generates the minimal transitive Spine proto set for command/event envelopes and
actor/tenant/version context before adding higher-level TS envelope construction
helpers in later slices.

Alternatives considered:

- Implement TS-only envelope interfaces first. Rejected because it would violate
  the preserved Protobuf contract requirement and risk source-level drift from
  Spine message definitions.
- Copy every remaining Spine core/server/client proto now. Deferred because the
  task should keep scope reviewable and avoid pulling storage/service contracts
  before the envelope/context surface is needed.
- Generate from external imports without copying transitive support protos.
  Rejected because the repository must preserve copied Spine contracts and make
  Buf generation reproducible from pinned sources.

Consequences:

- T-0007a will add more curated `@spine-ts/proto` exports and default core
  registry entries.
- High-level `packCommand`, `packEvent`, origin-chain helpers, and validation
  policy can use generated contracts instead of hand-written message shapes.
- Runtime command/event bus tasks can rely on canonical type URLs and generated
  schemas.

## D-0031: Pin legacy base support protos used by core signal context

Status: Accepted

Date: 2026-06-28

Context: T-0007a copies the minimal transitive proto set for Spine
`Command`, `Event`, and actor/tenant context. The researched 2.0-series
`SpineEventEngine/base` commit used by T-0004 contains `spine/options.proto`,
`spine/base/field_path.proto`, and `spine/string/template_string.proto`, but
does not contain `spine/net/email_address.proto`,
`spine/net/internet_domain.proto`, or `spine/ui/language.proto`. Those files
were present only in a local extracted include-protos cache from a separate
Spine-using project. The cache alone was not enough provenance for
`proto/spine-sources.json`.

Decision: Copy the three support protos from the local extracted include-protos
cache only after verifying they match `SpineEventEngine/base` tag `v1.9.0`
commit `4e5dc1e9f3f361d3ac283d366cf2b639b1f62c12` byte-for-byte. Record that
commit, raw URL, source URL, and SHA-256 in `proto/spine-sources.json`.

Evidence:

- Local project dependency metadata pins `io.spine:spine-base:1.9.0`.
- `git ls-remote --tags https://github.com/SpineEventEngine/base.git`
  returned tag `v1.9.0` at
  `4e5dc1e9f3f361d3ac283d366cf2b639b1f62c12`.
- Raw GitHub checksums for the three files matched the local extracted copies:
  `d3fde13f40d61160933184b41a6221e06933191fb493c55778ce8e5789eb1ca6` for
  `email_address.proto`,
  `7efff4e0cb9c0052f245565fc5ac643bb1196cd0ecbdaa98b342ebb9c8fcc092` for
  `internet_domain.proto`, and
  `197d6d89ba396a0e4654665af63f5dcf39061820378e8cbb71fb082a51475418` for
  `language.proto`.

Alternatives considered:

- Attribute the extracted files to the 2.0-series base commit. Rejected because
  that commit does not contain the files.
- Omit `TenantId` or `ActorContext` transitive support. Rejected because it
  would make the copied command/event context closure incomplete.
- Rewrite smaller local replacements. Rejected by the Protobuf contract's
  verbatim-copy requirement.

Consequences:

- The T-0007a closure mixes 2.0-series core/time/validation contracts with the
  exact older base support protos required by those context messages.
- Future proto refresh work should revisit whether newer Spine repositories
  moved or renamed the net/UI support contracts before changing these manifest
  entries.

## D-0032: Use Spine-aware Any packing for core envelope helpers

Status: Accepted

Date: 2026-06-28

Context: T-0007b adds the first `@spine-ts/core` helpers for packing domain
messages into generated `spine.core.Command` and `spine.core.Event` envelopes.
Buf Protobuf-ES provides WKT `anyPack()` and `anyUnpack()` helpers, but
`anyPack()` currently builds type URLs with the standard
`type.googleapis.com/<full.type.Name>` prefix. Spine contracts declare
`option (type_url_prefix) = "type.spine.io"` and runtime routing depends on the
canonical Spine URL produced by the existing `deriveTypeUrl()` registry helper.

Decision: Implement T-0007b packing with `deriveTypeUrl(schema)` and
Protobuf-ES binary serialization rather than direct `anyPack()` use. Keep
unpacking/checking helpers exact-type-url aware so callers do not parse or
compare type URLs ad hoc.

Alternatives considered:

- Use Buf `anyPack()` directly. Rejected because it emits
  `type.googleapis.com/...` and would silently break Spine routing/type URL
  compatibility.
- Add local string concatenation at call sites. Rejected because it repeats type
  URL policy outside the core registry seam.
- Defer packing until runtime buses. Rejected because later command/event bus
  and service tasks need a tested canonical envelope construction surface.

Consequences:

- `@spine-ts/core` owns the Spine-aware `Any` packing seam.
- Command/event helpers can validate and pack payloads without exposing binary
  or type URL details to framework users.
- Future runtime tasks can consume generated `Command` and `Event` envelopes
  without inventing a second packing policy.

## D-0033: Start storage with package-owned contracts and in-memory adapter

Status: Accepted

Date: 2026-06-28

Context: The roadmap after core envelope construction points to `T-0008 Storage
Foundation`. Runtime architecture requires storage boundaries for entity
records, aggregate event histories and snapshots, read-side projection records,
delivery inbox records, tenant index records, and diagnostics. The repository
already has an `@spine-ts/storage` package skeleton, while repository,
transaction, bus, delivery, and ZeroMQ runtime behavior remain separate future
tasks.

Decision: Implement the first storage slice in `@spine-ts/storage` as
framework-owned TypeScript contracts plus an in-memory adapter. Keep it
record-oriented and asynchronous, with separate write/read storage concepts
where useful, but do not couple it to repositories, buses, decorators,
transport, or production databases yet.

Alternatives considered:

- Put storage contracts in `@spine-ts/core`. Rejected because storage is a
  runtime adapter boundary and `core` already owns metadata, validation, and
  envelope helpers.
- Start with a production database adapter. Rejected because no repository or
  delivery runtime exists yet and the storage seam needs tests before selecting
  durable infrastructure.
- Delay storage until repositories exist. Rejected because repository and
  delivery tasks need a stable adapter seam and an in-memory test backend.

Consequences:

- `@spine-ts/storage` becomes the package owner for storage interfaces and the
  first in-memory implementation.
- Future repository, delivery, projection, and transport tasks can depend on a
  tested storage seam without importing ZeroMQ or service concerns.
- T-0008a must document that in-memory storage is for tests/development and is
  not durable across process restarts.

## D-0034: Keep entity metadata in server with narrow proto option exports

Status: Accepted

Date: 2026-06-28

Context: The next roadmap slice is `T-0009 Entity And Handler Model`. The first
implementable sub-task needs descriptor-derived entity metadata: entity
kind/visibility, query columns, `(set_once)` fields, first-field routing hints,
and semantic tags from `(is)`/`(every_is)`. The generated `spine/options.proto`
file already contains the required Protobuf-ES extension descriptors, but the
`@spine-ts/proto` package root intentionally exposes only curated contracts.
The current `@spine-ts/server` package is still a skeleton and should own
server/runtime entity semantics rather than pushing repository-specific metadata
into `@spine-ts/core`.

Decision: Implement `T-0009a` by keeping entity metadata extraction in
`@spine-ts/server` and adding only narrow curated `@spine-ts/proto` root exports
for the Spine option descriptors and enum/message types required by that
extractor. Generic schema/type URL lookup remains in `@spine-ts/core`.
Decorators, handler registration, transactions, repositories, buses, storage
writes, and ZeroMQ remain out of scope for `T-0009a`.

Alternatives considered:

- Broadly re-export generated `spine/options_pb.ts`. Rejected because the proto
  package has an explicit curated-export policy and API docs check guarding
  against broad generated re-exports.
- Put entity metadata extraction in `@spine-ts/core`. Rejected because entity
  kind, visibility, columns, and routing hints are server/runtime model
  concerns, while `core` should stay focused on type registry, validation, and
  envelope helpers.
- Delay option exports until handler decorators. Rejected because transaction
  validation and handler metadata need the same descriptor surface, and
  `T-0009a` can test it without import-time side effects.

Consequences:

- `@spine-ts/proto` grows a small explicit public option surface.
- `@spine-ts/server` becomes the owner of entity metadata extraction and can use
  it later for handler registration, transaction validation, and repository
  assembly.
- Reviewers must verify that `T-0009a` does not introduce runtime registration,
  decorators, storage writes, buses, transport, or repository behavior.

## D-0035: Implement explicit handler registration before decorators

Status: Accepted

Date: 2026-06-29

Context: `T-0009b Handler Metadata Contract And Explicit Registration API`
continues the entity/handler model after descriptor-derived entity metadata.
The framework needs handler metadata for command assignment, command reaction,
event subscription, event reaction, and event application before later
transaction and runtime tasks can validate or invoke anything. TypeScript 5+
standard decorators may be useful, but decorator behavior and metadata
collection would add runtime/import-order questions before the core contract is
proven.

Decision: Implement an explicit OOP-style registration API first. It will bind
generated Protobuf-ES schemas to entity class method names and produce frozen,
deterministic handler metadata without instantiating entities or invoking
methods. Decorator support in `T-0009c` must target the same metadata contract
rather than inventing a parallel registration model.

Alternatives considered:

- Start with TypeScript decorators. Rejected because decorator metadata would
  couple the first handler contract to import-time side effects and still need
  an explicit fallback for users who avoid decorators.
- Delay handler metadata until the transaction kernel. Rejected because
  transaction validation needs a tested metadata surface and would otherwise
  mix API design with execution semantics.
- Build a full runtime registry immediately. Rejected because duplicate
  registration and lookup validation can follow once the explicit definition
  shape is stable.

Consequences:

- `@spine-ts/server` gets a deterministic, testable handler metadata surface
  before runtime execution exists.
- Later decorators can remain syntax sugar over explicit registration.
- Reviewers must verify that `T-0009b` does not implement handler invocation,
  transactions, repositories, buses, storage writes, or ZeroMQ transport.

## D-0036: Use caller-owned handler registry with first duplicate policy

Status: Accepted

Date: 2026-06-29

Context: `T-0009b.3 Handler Metadata Registry And Validation` follows the
explicit handler metadata contract from D-0035. The runtime architecture states
that a bounded context should have one effective handler per command message
type unless transformation/splitting is explicitly modeled, while events must
fan out to eligible subscribers/reactors/projections. The framework needs a
validated registry surface before decorators, repositories, and transaction
execution can consume handler metadata.

Decision: Implement the first handler metadata registry as caller-owned,
lookup-only data in `@spine-ts/server`. The registry registers existing
`EntityHandlersMetadata` objects, freezes deterministic listing/lookup views,
and rejects duplicate/conflicting declarations that would make later routing
ambiguous. The first public policy is:

- one command assignment per command message full type name in one registry;
- one event application per entity state full type name and event message full
  type name in one registry;
- event subscriptions, event reactions, and command reactions may have multiple
  handlers because later fan-out and process-manager behavior need many-to-one
  metadata.

The registry must not instantiate entities, invoke handlers, unpack payloads,
write storage, start buses/transports, or mutate global process state.

Alternatives considered:

- Keep registry validation deferred until repositories. Rejected because
  repositories and decorators would then each need ad hoc duplicate checks.
- Use a global process-wide registry. Rejected because import-order and test
  isolation would become observable before bounded-context assembly exists.
- Reject duplicate event subscriptions/reactors. Rejected because event fan-out
  is a core runtime requirement and would over-constrain projection/reactor
  modeling.

Consequences:

- Later decorators can emit or adapt to the same explicit registry contract.
- Later repository/routing tasks can rely on prevalidated command-assignee and
  event-applier uniqueness.
- Custom command routing or transformation/splitting may require a future
  extension of the duplicate policy, but the first lookup-only registry remains
  deterministic and conservative.

## D-0037: Use standard decorators as metadata-only handler adapters

Status: Accepted

Date: 2026-06-29

Context: `T-0009c.1 Decorator Metadata Collection` follows the explicit handler
metadata contract and caller-owned registry from D-0035 and D-0036. The
developer API calls for TypeScript 5+ standard decorators when they fit, while
preserving an explicit fallback and avoiding legacy `emitDecoratorMetadata`,
parameter decorators, import-order-sensitive globals, or runtime invocation
during metadata declaration.

Decision: Implement decorator support as syntax over the explicit handler
metadata contract. Public `@Assign`, `@Command`, `@Subscribe`, `@React`, and
`@Apply` method decorators must require explicit Protobuf-ES schemas, collect
class-owned deterministic metadata, and expose a materialization function that
returns the same `EntityHandlersMetadata` shape accepted by
`HandlerMetadataRegistry`. The explicit `defineEntityHandlers()` API remains the
fallback and the canonical metadata shape. Decorators must not instantiate
entities, invoke handlers, unpack payloads, write storage, start buses or
transports, or mutate a global process-wide registry.

Alternatives considered:

- Use legacy decorator metadata or `reflect-metadata`. Rejected because the
  project targets TypeScript 5+ standard decorators and explicit schema
  arguments preserve Protobuf contract clarity.
- Register decorated handlers in a global registry at import time. Rejected
  because import order would become observable and would make tests and bounded
  contexts harder to isolate.
- Skip decorators and rely only on explicit registration. Rejected because the
  developer API asks for annotation-like OOP handler declaration when standard
  decorators can fit without replacing explicit registration.
- Use code generation as the first decorator-like mechanism. Rejected for this
  slice because standard decorators can be tested locally against the same
  metadata contract before adding a generation pipeline.

Consequences:

- Decorator APIs must remain metadata-only and registry-compatible.
- Reviewers must verify there is no import-time global registration, handler
  invocation, repository/runtime behavior, storage write, bus, gRPC, or ZeroMQ
  behavior in T-0009c.1.
- If local TypeScript standard decorator semantics prove insufficient for a
  particular ergonomic goal, the explicit registration API remains supported and
  a later codegen task can be proposed without changing the registry contract.

## D-0038: Enforce set-once after the first committed entity state

Status: Accepted

Date: 2026-06-29

Context: `T-0009d.1 Built-In Set-Once Transition Validation` starts the
transaction/runtime validation roadmap without implementing transactions,
repositories, storage writes, or handler dispatch. Entity metadata already
surfaces fields marked with Spine `(set_once) = true`, and the core package
already exposes a framework-owned `validateTransition()` seam that sanitizes
transition-rule violations into repo-local `spine.validation.*` messages.
Proto3 scalar fields do not preserve user intent to set a default value, so the
first slice needs a deterministic committed-state rule.

Decision: Implement `(set_once)` as a server transition-validation rule over
previous and next entity state messages. Creation transitions where
`previous === undefined` pass built-in set-once checks for supported field
shapes. Once a previous state exists, each supported `(set_once)` field value is
fixed; any unequal proposed next value violates the rule, including
default-to-non-default changes. Unsupported field-shape handling is recorded in
D-0039. The public first slice should expose a high-level entity-state
transition validation API and keep low-level rule construction private unless
later tasks show caller value. Violation results must be shaped through the core
transition-validation facade and must not leak previous or next field values.

Alternatives considered:

- Treat default previous values as unset and allow a later non-default value.
  Rejected because proto3 presence is not reliable for all scalar fields and
  storage snapshots represent committed state.
- Expose a public `createSetOnceTransitionRule()` immediately. Rejected because
  the runtime needs a high-level entity transition validator first, and exposing
  rule construction would broaden the API before caller needs are proven.
- Enforce set-once only inside repositories. Rejected because repository work
  comes later and should consume a tested validation primitive.

Consequences:

- `@spine-ts/server` may depend on `@spine-ts/core` for transition result
  shaping while keeping storage and dispatch out of scope.
- Future transaction/entity-base/repository tasks can call the same high-level
  validator before commit.
- Reviewers must verify that T-0009d.1 does not instantiate entities, invoke
  handlers, apply events, read/write storage, start buses, mutate global
  runtime state, or introduce gRPC/ZeroMQ behavior.

## D-0039: Keep server validation boundaries JVM-familiar

Status: Accepted

Date: 2026-06-29

Context: During T-0009d.1 fix round 5, the human observed that server-module
work may be over-inventing behavior compared with Spine JVM. The local
`spine-jvm-docs/` corpus is available in this repository and summarizes the
server/runtime behavior expected from Spine JVM `core-jvm`.

JVM docs inspected for this decision:

- `spine-jvm-docs/README.md`, Generated/Runtime Contract;
- `spine-jvm-docs/spine-validation-storage-observability-and-support.md`,
  Validation runtime, Field options, and Entity state sections;
- `spine-jvm-docs/spine-domain-model-and-signals.md`, Validation Options That
  Affect Modeling;
- `spine-jvm-docs/spine-entities-repositories-and-state.md`, Transactions and
  State Builders.

Additional `core-jvm` server source inspected during T-0009d.1 fix round 10:

- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/entity/Transaction.java`,
  transaction buffering and commit/update flow;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/entity/TransactionalEntity.java`,
  active-transaction builder access;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/entity/AbstractEntity.java`,
  state update validation;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/entity/InvalidEntityStateException.java`,
  structured validation exception creation.

Decision: Server-module work must check task-relevant local Spine JVM notes and,
when available, the corresponding `core-jvm` `server` source before introducing
or expanding server/runtime behavior. For set-once validation, stay close to the
JVM-familiar contract: enforcement belongs at generated builder/factory or
state-update validation boundaries over normal Protobuf entity state, structured
violations are surfaced through the validation facade, and repeated/map/explicit
optional `(set_once)` fields are unsupported in the JVM generation contract. In
TypeScript, unsupported repeated, map-valued, and explicit optional set-once
fields therefore fail closed with field-specific validation violations instead
of adding speculative collection or presence comparison in this task.

This does not make arbitrary hostile JavaScript object graphs part of the
primary public contract. The T-0009d.1 hardening tests exist to preserve
field-specific, sanitized failures at the public API boundary when callers pass
forged or proxy-backed values; they should not grow into a broad adversarial
object comparison subsystem unless a later runtime threat model requires it.

Alternatives considered:

- Implement canonical repeated, map-valued, or explicit optional set-once
  comparison now. Rejected because JVM notes say repeated/map/explicit optional
  `(set_once)` is unsupported at build time, and collection/presence
  canonicalization policy has not been designed for this contract.
- Continue expanding defensive equality for every hostile JavaScript object
  shape. Rejected because the server runtime should be designed around
  framework-controlled Protobuf state updates, with unsupported/adversarial
  inputs documented and failed closed.

Consequences:

- Future `@spine-ts/server` tasks must record relevant JVM docs and
  corresponding `core-jvm` server source inspection in task logs before
  broadening server behavior.
- T-0009d.1 keeps the server validator narrow: catch proxy reflection failures
  and report repeated/map-valued/explicit optional set-once as unsupported,
  without adding new validation abstractions.
- A later task may revisit repeated, map, or explicit optional support only
  after checking the JVM compatibility impact and deciding the relevant
  collection or presence canonicalization policy.
