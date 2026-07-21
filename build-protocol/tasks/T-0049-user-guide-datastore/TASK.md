# T-0049: User guide correctness and Datastore development guide

Status: Implementation verified; canonical review pending

## Objective

Make `docs/USER_GUIDE.md` wholly accurate against the current public codebase,
including practical inline code snippets, and add comprehensive end-user
guidance for developing, configuring, testing, and operating applications with
the optional Google Cloud Datastore adapter.

## Human-Imposed Requirements Ledger

- Review all prose and inline code snippets in the framework user guide against
  the latest codebase; statements and snippets must describe actual supported
  behavior.
- Inline code snippets must be present. Practical snippets must use current
  public imports and APIs and be compiled or otherwise mechanically checked
  where feasible.
- Add one or more separate Datastore sections forming a comprehensive guide,
  including the development approach, configuration options, and code snippets.
- Push every commit to `origin` immediately after it is created.
- Preserve unrelated user files and never read, edit, stage, move, or delete
  `human-review-1-jul.md`.
- Follow `AGENTS.md`, `build-protocol/BUILD_PROTOCOL.md`,
  `build-protocol/PROJECT_COMPLETION_PLAN.md`, and
  `build-protocol/CODE_QUALITY.md`, including all four canonical review
  dispositions for this documentation-only task.

## Scope

- Primary deliverable: `docs/USER_GUIDE.md`.
- Supporting task, work, and review records under `build-protocol/`.
- A narrowly scoped documentation-snippet verification test or script may be
  added only when it provides durable proof that practical guide imports and
  APIs remain current.
- No runtime, public API, Protobuf, package dependency, generated-output, or
  publication/versioning changes.

## Acceptance Criteria

1. Every active behavioral claim in the guide is traced to current public
   source, tests, generated service contracts, or accepted package docs.
2. Practical TypeScript snippets use current public imports, current method and
   option names, valid handler signatures, and no forbidden end-user APIs.
3. Repository-only setup is clearly distinguished from installation of a
   published consumer package; the guide does not imply that private `0.0.0`
   workspace packages are currently available from a registry.
4. Datastore has a clearly separated, comprehensive chapter covering:
   composition through `StorageFactory`; dependency and environment setup;
   injected-client and factory-owned-client configuration; credentials and
   emulator configuration; namespaces/tenant mapping; canonical IDs and value
   types; indexed columns and composite indexes; query pushdown and bounded
   local reconciliation; writes, batches, CAS, retries, lifecycle, ownership,
   error/redaction behavior; emulator-first development; optional cloud smoke;
   production limitations; and runnable code/command snippets.
5. The guide links to the Datastore package README and relevant runnable
   examples without presenting internal or test-only APIs as end-user APIs.
6. Documentation formatting, links, TypeDoc/API checks, release-readiness link
   checks, end-user API prohibition scans, and any added snippet checks pass.
7. All four canonical review concerns are CLEAN or have a concrete N/A
   disposition; documentation and TypeScript/API review are required.
8. Final task verification, merge into `main`, post-merge verification, and
   immediate pushes of the task branch and `main` succeed.

## High-Risk Assumptions

- “Comprehensive” means comprehensive for the adapter behavior currently
  shipped, not a promise of Firestore Native mode, production index deployment,
  cloud consistency behavior, implicit credential policy, or new generic
  storage/query APIs.
- Code examples must stay on public package roots. Test fakes and provider
  internals may be described as development techniques but not copied as
  application APIs.
- This is documentation-only unless the audit proves a current public contract
  cannot be documented accurately without a separately authorized code change.

## Execution Surface And Assignment Gate

- Desktop supports the required explicit child model and reasoning dispatch.
- Baseline: `f421b7e3c4f0cca9b72b0a5db7352ccc019e1d06`.
- Branch: `task/T-0049-user-guide-datastore`.
- Worktree: `.worktrees/T-0049-user-guide-datastore`.
- One existing `implementer` will own guide and verification-support edits with
  expected `gpt-5.6-terra` / `medium`, explicitly dispatched.
- Mechanical checks are orchestrator-dispatched functions, not new roles.
- Required reviewers: existing style/maintainability, documentation,
  TypeScript/API, and performance/reliability reviewers with the profiles in
  `AGENTS.md`; actual runtime metadata must be recorded before acceptance.

## Skill Applicability

- Session inventory source: the skills catalog supplied to the orchestrator on
  2026-07-21. Task-relevant entries were triaged by name, description, and path.
- Selected and fully read before governed action:
  `doc-coauthoring` for structured audit, refinement, and reader testing;
  `using-git-worktrees` for isolated authoring; `subagent-driven-development`
  for the required bounded implementation owner; `requesting-code-review` for
  pre-merge review; and `verification-before-completion` for evidence-backed
  acceptance.
- `test-driven-development` is not selected because no runtime behavior change
  is authorized; durable snippet checks may be added from current public
  contracts without a production RED/GREEN cycle.
- `typescript-advanced-types`, `nodejs-backend-patterns`, and
  `architecture-decision-records` were triaged from
  `build-protocol/skills/EXPECTED_SKILLS.md` and are not applicable because the
  task changes neither TypeScript contracts, backend runtime design, nor an
  architectural decision.
- Installed entrypoints were enumerated with
  `find /Users/armiol/.agents/skills -maxdepth 2 -type f -name SKILL.md -print`.
  The readable lock manifest `/Users/armiol/.agents/.skill-lock.json` and the
  repo expected-skill manifest were inspected. Skills remain advisory under the
  project protocol and explicit human requirements.

## 2026-07-21 — Implementer source audit and guide refinement

- Existing role/function: `implementer`, explicitly assigned by the
  orchestrator with expected `gpt-5.6-terra` / `medium`. This execution surface
  does not expose verifiable actual runtime model/reasoning metadata to this
  author; acceptance of that dispatch remains the orchestrator's gate.
- Own skill applicability check was completed before edits. `doc-coauthoring`
  applies because this is a reader-facing technical guide; its source-audit,
  refinement, and reader-oriented guidance informed the guide pass.
  `verification-before-completion` applies before any completion claim and was
  read for the upcoming focused evidence pass. `using-git-worktrees` applies
  only to confirm the supplied linked worktree, so no worktree was created.
  `test-driven-development` remains N/A because no runtime change is allowed.
- The complete guide was read sentence-by-sentence and its active claims and
  snippets were compared with public package roots, relevant implementation and
  tests, generated service imports, package READMEs, and runnable examples.
  Primary audit sources: `packages/server/src/**`, `packages/storage/src/**`,
  `packages/storage-datastore/src/**` and `test/**`,
  `examples/datastore-orders/**`, `examples/todo/**`, package metadata, and
  the accepted T-0046 task/work-log records.
- The repository-only installation section now says all framework workspace
  packages are private `0.0.0` packages and does not imply registry
  installation. The guide's local-IPC limitation now distinguishes existing
  child-process coverage from the absence of a public production multi-process
  topology.
- Replaced the brief Datastore note with a separate chapter covering the
  accepted adapter contract: composition, injected and constructed clients,
  credential boundaries, namespaces, canonical identifiers, indexed values and
  composite indexes, pushdown plus bounded reconciliation, batch writes, CAS
  and retry behavior, closure/ownership, redaction, emulator-first work, cloud
  smoke scope, and production limits. It links public package README and the
  runnable Datastore orders example without presenting internal codecs, fakes,
  or record-storage subclasses as application APIs.
- Corrected the emulator command to declare `--host-port=127.0.0.1:8081`, which
  matches `DATASTORE_EMULATOR_HOST`; without it the gcloud command defaults to
  port 8080. `StorageFactory.close()` wording now accurately says it only
  rejects future handle creation and leaves existing handles usable. Neither
  injected nor `create()`-constructed clients are explicitly closed by adapter
  code.

## 2026-07-21 — Orchestrator implementation acceptance

- Existing author role/task: `implementer`, `/root/t0049_guide_author`.
- Dispatch explicitly set `gpt-5.6-terra` / `medium`. The collaboration
  runtime configures the existing `implementer` role to exactly that immutable
  profile; this runtime role metadata matches the explicit dispatch and is the
  orchestrator's actual-profile evidence. The child context could not inspect
  its own metadata, which is recorded as a child-observation limitation rather
  than contradictory runtime evidence.
- Fresh orchestrator checks passed TypeDoc/API validation, release readiness
  (59 imports / 119 relative Markdown links), cleanup enforcement, Prettier,
  `git diff --check`, and the guide-only forbidden end-user/internal-import
  scan. Nineteen fenced TypeScript, Protobuf, Bash, or shell blocks remain.
- The implementation endpoint is accepted for commit, immediate branch push,
  and canonical review.
