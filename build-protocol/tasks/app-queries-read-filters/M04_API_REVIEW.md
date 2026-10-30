# M04 TypeScript/API review

Scope: frozen M04 changes against `54520ee63`, including activation status, native/Connect details, exact managed-client classification, and malformed/unknown/duplicate/cancel distinctions. Existing `typescript_api_docs_reviewer` role was explicitly dispatched with its configured `gpt-6-sol` / `medium` profile; runtime self-introspection was not exposed. Reviewed the TASK ledger, M04 evidence, approved unknown-activation contract, changed runtime, tests, and current API references.

## Disposition

**No actionable P0–P2 findings. No P3 observations.**

`ReadRequestStatus.unknownSubscription()` creates `NOT_FOUND` with `spine.client.SubscriptionValidationError`, numeric `UNKNOWN_SUBSCRIPTION`, and matching Connect detail plus native `spine-error-bin` (`packages/server/src/services/read-request-status.ts:36-53`). `SpineServices` uses it for absent records and registry `missing`/`expired` activation results; duplicate-active and closed delivery retain their prior separate outcomes (`packages/server/src/services/spine-services.ts:553-584`). Existing full-request validation still rejects malformed Activate/Cancel before lookup. Well-formed unknown Cancel remains an OK response. Native service and Coordinator tests check the structured reason and forwarding, including trailer/detail agreement.

The managed browser client retries `NOT_FOUND` only when a Connect `ErrorSchema` detail has both the exact enum-qualified type and `UNKNOWN_SUBSCRIPTION` code (`packages/client-web/src/client/client.ts:1779-1812`). The existing bounded recovery path obtains a new server-issued ID, performs Entity authoritative-query recovery or emits Event `gapPossible`, and stops on cancellation or exhausted attempts. Tests distinguish unrelated `NOT_FOUND`, malformed input, denied/unauthenticated failures, and `TENANT_UNKNOWN`, and cover duplicate activation and unknown cancellation. Current API and browser references describe these contracts.

The orchestrator supplied 291/291 focused tests, passing generated build and cheap checks, and changed-runtime coverage of 93.8% statements and 94.7% branches. This review inspected the frozen source and tests without repeating those checks. Later filters and authentication work remain outside M04.
