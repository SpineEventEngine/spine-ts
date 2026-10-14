# Targeted documentation correction review

Scope: working diff from `HEAD` in the six assigned documentation/TSDoc surfaces; immediate runtime source checked only for the five corrected claims. Existing performance/reliability reviewer profile: explicit `gpt-6-sol` / `medium`, Standard speed; runtime self-introspection unavailable. Source inspection only; no tests or services run.

## Finding

- **P2 — Scope the PostgreSQL retry promise to ordered writes.** `packages/storage-postgres/REFERENCE.md:73-75` says that for a `40P01` deadlock or `40001` serialization failure, `commit` replays the captured input once. In `packages/storage-postgres/src/postgres/entity-commit.ts:187-194`, `records.prepare()` runs *outside* the inner catch that checks `retryable(error)` and calls `apply` a second time. Table preparation performs SQL through `PostgresRecordStorage.prepare()`, so the current wording would also promise a replay when one of those codes arises during preparation; that path throws without retry. State explicitly that one replay applies to a selected failure **during ordered record writes**, after preparation succeeds. The captured input, unchanged Event IDs and wire-byte collision claims match the source.

## Clean targeted dispositions

- `packages/server/REFERENCE.md`: direct cleanup correctly describes checks on the supplied delivered row followed by ID deletion, the absence of a stored-row snapshot comparison, and the gap after shard validation. The remote path makes a separate bounded removal request. No unsupported atomic rollback claim remains.
- `docs/BROWSER_CLIENT_AUTH_EXTENSION_GUIDE.md`: readiness is a matching successful response-only activation ACK; the client validates topic and subscription ID and requires no business update.
- `docs/api/README.md`, `packages/server/REFERENCE.md`, and `packages/server/src/delivery/delivery-supervisor.ts`: `graceMs` defaults to 30,000 ms for each of two close phases, while `#closeNow` can subsequently await unsettled active work. The docs distinguish context and managed-server deadlines. The supervisor source diff changes comments only.
- `examples/message-board/app/README.md`: the documented local and web port variables, defaults, allowed port zero, `webOrigin`, and ready message agree with the local entrypoint. The code sample is labeled a default-port sketch.
- `packages/storage-postgres/REFERENCE.md`: the four family write order, visible completed prefix, independent interleaving, captured input, and immutable wire-byte collision descriptions agree with `PostgresEntityCommitStorage.apply` and record storage.
