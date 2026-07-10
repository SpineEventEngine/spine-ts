# T-0024: Roadmap/Spec Reconciliation

Status: complete
Start: `2026-07-10T02:33:16Z`
Baseline commit: `a964cc9a`
Branch: `task/T-0024-roadmap-spec-reconciliation`
Worktree:
`.worktrees/T-0024-roadmap-spec-reconciliation`

## Objective

Reconcile active Spine TS roadmap, spec, and user-facing documentation after
upstream Spine JVM ADR 0001 revised aggregate behavior away from event sourcing
and dropped event import.

## Scope

- Update active docs/specs so aggregate event import/importer work is removed
  from the active TS plan, not deferred.
- Keep projection catch-up, transport-backed/background workers, retry
  monitors, retained attempt history, production policy, and delivery-label
  compatibility cleanup as real remaining gaps where already documented.
- Record the decision in `build-protocol/DECISION_LOG.md`.
- Keep `IMPORT_EVENT` and `CATCH_UP` runtime/proto surfaces unchanged.
- Keep changes docs/spec/log only; do not edit source, tests, or generated docs
  under `docs/api/reference`.
- Keep `human-review-1-jul.md` untouched if present.

## ADR/JVM Inspection

- Upstream Spine JVM ADR 0001 is accepted. Revision D1 on 2026-07-05 drops event
  import, removes `@Import`, `ImportBus`, import routing/endpoints, and related
  test API, and keeps `InboxLabel.IMPORT_EVENT` only as deprecated wire
  compatibility surface.
- Upstream ADR 0001 D2 makes aggregate/aggregate-part `@Apply` a
  model-building error; it is retained only so the model can detect and fail
  unsupported aggregate appliers.
- Upstream ADR 0001 shifts aggregates to load latest persisted state and mutate
  inside `@Assign`/`@React` transaction handlers. Events remain traceability
  journal records, not replay input for aggregate state.
- Local JVM notes in
  `spine-jvm-docs/spine-routing-dispatch-and-delivery.md` describe the old
  `ImportBus` path as tied to aggregate `@Apply(allowImport = true)` appliers
  and an aggregate `IMPORT_EVENT` inbox endpoint. This confirms the old import
  path is not a separate TS runtime gap once ADR 0001 removes aggregate
  appliers/import.

## Acceptance Criteria

- `build-protocol/DECISION_LOG.md` records T-0024 and the decision to remove
  aggregate import/importer work from the active TS roadmap.
- Active specs/docs no longer list aggregate event importers or event-import
  delivery as deferred runtime work.
- Supported aggregate event reactors are described only as ordinary generated
  `@React` handlers using current transaction semantics, not as event-sourcing
  appliers/importers.
- `IMPORT_EVENT` label cleanup remains documented as a later compatibility
  contract task.
- Historical review/task/work logs may retain old text only when the context is
  clearly historical.
- `pnpm --config.verify-deps-before-run=false format:check` is run if
  dependencies are available, or the exact missing-dependency failure is logged.
- `git diff --check` passes.

## Verification Plan

- Run scoped `rg` scans over active docs to confirm stale
  `aggregate event reactors/importers` and aggregate import deferral wording is
  gone.
- Run `pnpm --config.verify-deps-before-run=false format:check`.
- Run `git diff --check`.
- Review the final diff to confirm only docs/spec/log files changed.

## Review Plan

- Ask reviewers to check the reconciled wording against upstream ADR 0001 D1/D2
  and the local JVM import notes.
- Ask reviewers to verify that remaining gaps still include projection catch-up,
  production/background delivery policy, retry/monitoring, retained attempt
  history, and delivery-label compatibility cleanup.
- Ask reviewers to reject any runtime/source/test changes or removal of
  `IMPORT_EVENT`/`CATCH_UP` in this task.
