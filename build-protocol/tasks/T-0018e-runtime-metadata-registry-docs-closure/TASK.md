# T-0018e: Runtime Metadata And Registry Docs Closure

Status: planned
Started: `2026-07-09`
Branch: `task/T-0018e-runtime-metadata-registry-docs-closure`
Worktree:
`.worktrees/T-0018e-runtime-metadata-registry-docs-closure`
Base commit: pending

## Objective

Reconcile public documentation and durable state after T-0018a through T-0018d.
Runtime signal metadata generation, example/test adoption, `void` `@React`
generated-registry support, and descriptor-derived generated schema roles are
implemented. Public docs must stop listing those items as missing and must name
the actual remaining runtime gap: semantic-tag consumption in handler and
routing registration.

## Scope

- Update public docs that describe framework readiness and generated registry
  behavior:
  - `README.md`
  - `docs/USER_GUIDE.md`
  - `docs/architecture/README.md`
  - `docs/api/README.md`
  - `packages/server/README.md`
  - `examples/todo/README.md`
  - `examples/todo/USER_GUIDE.md`
- Update durable T-0018e review/work logs.
- Do not change runtime/source behavior unless a reviewer finds a direct docs
  contract mismatch that cannot be resolved by documentation.
- Do not edit generated files.

## Acceptance Criteria

- Public docs no longer describe runtime metadata generation, example/test
  adoption, `void` `@React` support, or descriptor-derived generated-registry
  role discovery as missing or deferred.
- Public docs describe the actual remaining functional gap: semantic-tag
  consumption in runtime handler and routing registration.
- Generated-registry docs reflect the current contract:
  - bare decorators;
  - descriptor-derived command/event roles;
  - explicit return-type rules, including generated emitted schemas and
    explicit `void` for `@Subscribe` and no-emission `@React`;
  - no app-owned materialization;
  - no schema-bearing decorators;
  - no framework `Command`/`Event` envelopes in ordinary end-user handlers;
  - no `@Apply`;
  - no manual end-user transactions.
- The to-do example docs remain accurate for a fully runnable in-memory
  gRPC/query/subscription application.
- No generated files are committed.
- Durable logs record the selected task, worktree/branch, review lanes, fixes,
  and verification.

## Verification Plan

- Targeted stale-wording scans with `rg` for old missing/deferred metadata and
  generated-registry language.
- `pnpm --config.verify-deps-before-run=false docs:check`.
- `pnpm --config.verify-deps-before-run=false typecheck:build`.
- `pnpm --config.verify-deps-before-run=false format:check`.
- `git diff --check`.

## Requirements Splitter Result

- Splitter: `019f482d-f4d7-7960-85ce-5dff71711f84`; completed and closed by
  root.
- Selected this task as the next non-blocked slice after T-0018d.
- No blockers reported.
