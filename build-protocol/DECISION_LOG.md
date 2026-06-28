# Decision Log

Navigation: [README](README.md)

Future implementation must append every decision here or to a task-specific decision file linked from here.

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
