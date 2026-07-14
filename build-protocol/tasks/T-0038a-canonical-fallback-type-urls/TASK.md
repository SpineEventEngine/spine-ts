# T-0038a: Canonical Fallback Type URLs

Status: Framed; implementation assigned

Started: `2026-07-14T01:50:36Z`

Baseline commit: `75340852`

Branch: `task/T-0038a-canonical-fallback-type-urls`

Worktree: `.worktrees/T-0038a-canonical-fallback-type-urls`

Parent: T-0038 accepted-capability audit at planning checkpoint `9addd3b0`.

This `Status` header is canonical for T-0038a. Work/review mirrors must agree.

## Objective

Reject malformed caller-supplied fallback type-URL prefixes before public
prefix selection or derivation can return a noncanonical URL, while preserving
every accepted Spine-option, default, and valid custom fallback result.

## Human-Imposed Requirements Ledger

- Continue autonomously until the child is integrated or a real blocker occurs.
- Implement this child in its own branch/worktree with one Terra Medium author,
  TDD, focused inner checks, relevant independent reviews, final task verify,
  main merge/post-merge verify, push, and clean worktree removal.
- `getTypeUrlPrefix(schema, fallbackPrefix)` and
  `deriveTypeUrl(schema, { fallbackPrefix })` are the only custom-fallback input
  paths. Do not claim or add a fallback option to packing or registry APIs.
- When a schema has no Spine `type_url_prefix`, normalize permitted trailing
  `/` separators, then reject a fallback whose remaining prefix is empty or
  contains whitespace. At minimum `""`, whitespace-only, `/`, and `///` reject
  with one deterministic `TypeError`.
- Preserve valid bare and trailing-slash custom prefixes, the default
  `type.googleapis.com`, and Spine file-option precedence. An unused malformed
  fallback must not invalidate a valid file option.
- Keep validation in one existing owner. Add no helper export, public error
  class, new option, generated facade, Protobuf change, or unrelated refactor.
- Update concise public TSDoc and `packages/core/README.md` only for the accepted
  validation/compatibility contract. Broader guide reconciliation stays T-0039.
- Preserve generated-output policy and public export count; generated files
  remain ignored and untracked.
- Run only relevant reviewer lanes and record concrete N/A dispositions. No
  per-task security lane; carry validation relevance to T-0041.
- Reviewer prompts must ignore superseded historical text unless current child
  records or changed active docs claim it.
- Explicitly dispatch model/reasoning and accept only matching immutable role
  metadata. Subagents must not spawn subagents.
- Never read, modify, stage, or delete the user-owned root
  `human-review-1-jul.md` file.

## Exact Contract

- Validate fallback only when the schema file supplies no Spine prefix option.
- Remove trailing `/` separators for validation/canonicalization; the remaining
  prefix must be non-empty and contain no whitespace.
- Valid `type.example.test`, `type.example.test/`, and repeated trailing slash
  forms produce exactly `type.example.test/<schema.typeName>`.
- A schema's valid Spine option wins even when the unused fallback argument is
  malformed.
- Omitted fallback continues to use `DEFAULT_TYPE_URL_PREFIX`.
- `getTypeUrlPrefix()` and `deriveTypeUrl()` share one policy owner and
  deterministic `TypeError`; no new error hierarchy.
- `packAny()` / `packCommand()` / `packEvent()` and implicit
  `TypeRegistry.register()` expose no custom fallback. Their unchanged
  canonical behavior is regression evidence only.

## TDD Acceptance

- RED table proves malformed fallback forms currently return or derive invalid
  text, then GREEN proves exact `TypeError` class/message.
- Valid custom bare/trailing-slash forms, default fallback, and Spine-option
  precedence remain exact.
- Packing, implicit registry default derivation, and explicit valid registry
  URLs remain unchanged.
- Public TSDoc and core README state normalization/rejection without broadening
  the API or claiming behavior beyond current code.
- Core focused tests, generated build typecheck, scoped ESLint, docs/API checks,
  Prettier, generated-clean, and diff checks pass before review.

## Scope

- Likely source/test: `packages/core/src/index.ts`,
  `packages/core/test/index.test.ts`.
- Likely docs: `packages/core/README.md` and public TSDoc in the source file.
- This task/work/review record set.
- Exclude server, transport, storage, example, Protobuf source, generated output,
  public exports, package manifests, and unrelated docs.

## Planning And Model Disposition

- Selective Sol High planning was completed and accepted in parent checkpoint
  `9addd3b0`; do not re-plan the child.
- Existing implementer role: explicit expected `gpt-5.6-terra` / medium, no
  subagents. Terra High is reserved for correctness/API/reliability review.
- Author owns source, focused tests, narrow docs, and these child records only;
  no commits, pushes, merges, or worktree operations.

## Skill Applicability Check

- Session inventory, repo expected-skill manifest, readable user entrypoints,
  and installed lock are available. Orchestrator selected/read
  `subagent-driven-development`, `using-git-worktrees`,
  `requesting-code-review`, and `verification-before-completion` earlier in the
  session.
- Implementer must perform its own canonical check and read
  `test-driven-development` plus required references, `implement`,
  `typescript-advanced-types` if needed, and `verification-before-completion`
  before governed actions. Server/JVM inspection is N/A because no server code
  changes.

## Immediate Next Action

Dispatch the Terra Medium implementer for strict RED/GREEN and narrow docs,
then run focused coordinator verification and all relevant reviewers.
