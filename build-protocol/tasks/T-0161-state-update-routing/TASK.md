# T-0161: State-update routing and delivery

Status: Review corrections complete; targeted re-review pending

## Objective

Add JVM-style `StateUpdateRouting` to Projection repositories and deliver accepted
`EntityStateChanged` System events through the existing Projection Inbox.

## Classification

High-risk. This changes a public routing API, System-event dispatch, durable
Inbox admission/replay, and tenant-scoped Projection delivery.

## Baseline and isolation

- Baseline: `origin/main@68b2c428`.
- Branch: `task/T-0161-state-update-routing`.
- Worktree: `.worktrees/T-0161-state-update-routing`.
- Preserve unrelated worktrees and the dirty primary checkout; push only `origin`.

## Acceptance criteria

1. Export factory-only `StateUpdateRouting` and typed `StateUpdateRoute` declarations.
2. Snapshot repository route declarations and reject state routing on Aggregate or Process Manager repositories.
3. Select exact, `(is)`, `(every_is)`, replacement, then the first target-ID-compatible state field; validate route results atomically, cap at 1,000, copy, deduplicate, and freeze them; `[]` means no delivery.
4. Route only `EntityStateChanged` payloads to state subscribers through the paired System EventBus and existing `UPDATE_SUBSCRIBER` Projection Inbox.
5. Persist each selected target once; replay validates the stored target and never reruns application routing. Preserve tenant selection.
6. Cover defaults, custom precedence, empty/multicast/invalid results, System-event unpacking, replay, and unsupported entity families with focused RED/GREEN tests.

## Assignment

- Requirements splitter / frozen plan: existing role, explicit `gpt-5.6-sol` / high.
- Implementation: existing implementer, explicit `gpt-5.6-terra` / medium; no subagents.
- This surface does not expose runtime model metadata; explicit configured profiles are the durable evidence.

## Review and verification

Style, TypeScript/API, documentation/TSDoc, and performance/reliability reviews are required. Security is N/A for this internal routing/delivery slice; the Wave final security gate remains required.
