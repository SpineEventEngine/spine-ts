# M04 style and maintainability review

Scope: frozen M04 diff from `54520ee63`, the TASK ledger, M04 record, approved unknown-activation contract, and current repository standards. Existing `style_maintainability_reviewer` role was explicitly configured as `gpt-6-sol` / `medium`; actual runtime metadata is unavailable. The reported 291 focused tests, generated build, scoped lint/TSDoc/cleanup/docs/format/diff checks, and changed coverage are accepted as existing evidence. No suite was rerun.

## Finding

- **P2 — New successful recovery cases use requests the real service rejects.** `packages/client-web/test/client.test.ts:1771-1773` and `:1866-1868` create empty `TopicSchema` values for successful Event Subscribe and replacement flows. The new Entity recovery case at `:1927-1932` supplies a target but no Topic ID and returns a Query with no Query ID; its target uses `type.example/Entity` at `:1888-1891` rather than a generated Entity state type URL. `Client.createSubscription()` only adds actor context (`packages/client-web/src/client/client.ts:973-979`, `:3048-3051`), while the server validates the complete Topic before Subscribe (`packages/server/src/services/spine-services.ts:473-476`). The mock transport accepts these impossible success-path requests, so these tests do not prove recovery for an admissible Topic and Query. Supply complete, domain-correct Event/Entity Topics and an admissible authoritative Entity Query in the new cases, then retain the fresh-ID, gap, and resynchronization assertions.

The runtime changes reuse the existing retry episode and queues, and the new status path follows the existing structured error pattern. No further actionable style, naming, duplication, or TSDoc defect was found in this slice. M05 and later behavior was excluded.

## Correction disposition

Main confirmed the correction: new successful Subscribe requests use generated
ProjectCreated or ProjectOverviewState type URLs, nonempty Topic IDs and usable
criteria. Authoritative Query has a nonempty Query ID. Mock admission calls
Validate.check after client context binding. Success responses use OK. Seven
selected cases failed before fixture correction; all 115 client tests pass
afterward. No runtime change; finding resolved without another full review.
