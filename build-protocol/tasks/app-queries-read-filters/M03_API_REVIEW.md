# M03 TypeScript/API review

Scope: final frozen M03 tree against `cc19b416d`, including untracked `packages/server/src/services/read-request-status.ts`. Existing `typescript_api_docs_reviewer` profile, explicitly dispatched `gpt-6-sol` / `medium`; runtime self-introspection was not exposed. Reviewed the TASK ledger, M03 contract/evidence, approved status and validation requirements, changed service/core contracts, pinned Proto adaptation, current declarations and tests. M04 unknown activation and M08 authentication remain separate slices.

## Disposition

**No actionable P0–P2 findings. No P3 observations.**

`Query`, `Topic`, and lifecycle `Subscription` requests pass the shared validator before route/read or lifecycle mutation. The generic view exposes selected oneof members to the pinned validator on declared recursive edges; its opaque `Any` URL uses an invalid type-name sentinel, avoiding collision with registered message types while retaining nonempty presence. The supplemental registry pass still reports known malformed `Any` payloads with root-relative paths, and tests cover selected scalar/message oneofs, default singular skip, known and unknown `Any`, and duplicate avoidance.

The new status module maps declared constraint failures to enum-qualified `spine.client.QueryValidationError`, `TopicValidationError`, or `SubscriptionValidationError` with numeric reason and packed `ValidationError`. It supplies both native `spine-error-bin` and Connect typed details. Unsupported Query/Topic targets, semantic-invalid filters, and distinct tenant statuses use the specified channels; unexpected validator/read faults are sanitized `INTERNAL`. Direct service, Coordinator, native/gateway, and browser tests exercise the wire behavior. Well-formed empty Query reads remain successful.

The pinned `TargetFilters` change replaces only deprecated `(required_field)` with `(require).fields` using the same `id_filter|filter` expression. The source manifest retains the original upstream commit/path/checksum and adds a separate local checksum. The verifier reverses that exact one-line adaptation and checks the original bytes; the descriptor check rebuilds the original frozen set before comparing its unchanged digest. No authored Proto `optional` was introduced. Current package/API documentation reflects the RPC error channel.

The orchestrator supplied final 456/456 combined focused tests, passing affected build/lint/TSDoc/source/generated checks, changed-runtime coverage 96.2% statements and 94.1% branches, and an installed packed-consumer proof. This review inspected the final source and tests without repeating those checks.
