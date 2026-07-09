# T-0017g First Review Fix Brief

## Objective

Address the first-round T-0017g review findings without expanding scope beyond
process-manager command inbox handoff.

## Required Fixes

1. Simplify the internal shape.
   - Move delivery-specific state/behavior out of `BoundedContext` into one
     small context-owned internal capability/object.
   - Avoid callback-valued runtime members such as `drainInbox` and
     `nextDeliveryVersion`; if callbacks remain, callback names must satisfy
     the `on*` rule.
   - Remove or narrow the generic `RepositoryAccess.deliverCommand()` /
     `repositoryDirectDeliveries` surface. This task only needs
     process-manager command replay for the opted-in handoff path.

2. Enforce tenant safety before durable writes and before replay.
   - For multitenant process-manager handoff, require a non-blank tenant ID
     before `Inbox.receive()` writes any row.
   - Carry the active delivery/storage tenant into replay.
   - Reject any stored command whose tenant metadata does not exactly match the
     replay context before invoking handler code.

3. Validate and bind replayed commands.
   - Replayed inbox commands must pass the same schema validation boundary as
     `CommandBus` for the target command schema.
   - Before handler invocation, verify that repository routing for the stored
     command matches `InboxMessage.inboxId.targetId` and
     `InboxMessage.inboxId.targetTypeUrl`.
   - Invalid, forged, or mismatched inbox rows must fail before handler code.

4. Prove the target inbox row was delivered.
   - After a drain attempt, do not infer success from lack of a matching
     failure.
   - Verify the specific received inbox message reached `DELIVERED` before
     `context.commandBus().post()` resolves.
   - Treat shard pickup `SKIPPED` or bounded-page non-delivery as an observable
     failure/deferred outcome, or drain in a bounded way until the row is
     observed delivered.

5. Add focused tests.
   - Missing tenant in a multitenant context must fail before any durable inbox
     write.
   - Replayed inbox command with mismatched tenant or target ID/type must fail
     before handler invocation.
   - Pre-claimed shard must not report command post success as if the target row
     was delivered.
   - Backlog/page-boundary behavior must not report success until the target row
     is delivered.

6. Update docs/logs.
   - Fix stale wording in `docs/api/README.md`, `packages/server/README.md`,
     and `docs/architecture/README.md`.
   - Do not expose internal `HANDLE_COMMAND` labels in end-user-facing docs
     unless the text explicitly describes internal framework mechanics.
   - Update `build-protocol/work-logs/T-0017g-implementation-report.md` to
     record the coordinator `format:check` pass.
   - Append a fix report to `build-protocol/work-logs/T-0017g-fix-report.md`.

## Verification Required

- Focused repository routing tests covering the fixes.
- Focused bounded-context and delivery-worker tests if touched.
- `pnpm --config.verify-deps-before-run=false format:check`
- `git diff --check`
- Any typecheck/docs checks needed for changed public API/docs.
