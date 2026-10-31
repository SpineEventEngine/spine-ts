# Remaining App Query and read-side filter work

The [approved proposal](PROPOSAL.md) and [requirements ledger](TASK.md) remain
binding. Shared validation, Command/Event admission, read-service status mapping,
unknown-subscription activation, and passive local metadata migration are
implemented, including dependency discovery, App Query generation, trusted reader
forwarding, retained subscription reader binding, Server App Query execution,
typed clients, and Execute transport support. Remaining work follows below.

Each slice includes focused behavior tests, affected generated/build checks,
format/lint/TSDoc checks, coverage inspection and the relevant existing review
concerns. Use the existing implementation context for corrections and collect
one review wave before returning a correction batch. Keep detailed evidence
outside Git. Run the unchanged full release profile and final security review
after integration converges; a slice checkpoint does not complete this task.

## M11 — Typed filter execution over detached message trees

**Depends on:** M01, M08–M09. **Class:** high-risk new read-side contract.
**Paths:** a small `packages/server/src/stand/read-side-filter.ts` (public base
and context) plus an internal traversal module if warranted, server exports,
and focused domain-fixture tests.

Implement schema-typed `ReadSideFilter` and ReadSideContext. Index exact
registered type URLs, including prefixes. Capture operation, actor/effective
tenant, verified principal/authority facts, cancellation, producing BC when
present, and parent/field information. Process matching filters in registration
order, then deterministic children of the surviving replacement. Default is
roots only; `{ nested: true }` traverses intermediates, lists/maps/oneofs, and
registry-decoded Any. Each callback gets a detached mutable message and a
detached read-only parent snapshot. Null removes that occurrence with the
container-specific behavior from the proposal; it does not prune the parent.

**Acceptance/tests:** root opt-in distinctions; parent-first replacement with
new children; deterministic ordering; singular/list/map/oneof/Any removal;
registered prefix preservation; isolation from source and retained returned
objects across later filters and consumers; same-type enforcement; stack-safe
traversal, cancellation, and cycles/unserializable replacement rejection; cancellation;
unknown/undecodable nested Any errors when inspection is required. Never
revalidate outgoing state constraints or fall back to unfiltered data. Gate
focused filter tests, API/style/reliability review. Excludes storage mutation,
field-mask policy, and automatic value-copy tracking.

## M12 — Filter read boundaries and retained history

**Depends on:** M09–M11. **Class:** high-risk read/persistence separation.
**Paths:** BC builder and Stand, `services/{query-reader,spine-services}.ts`,
server App Query output path, `entity/entity.ts`, `repository/repository.ts`,
`agent/agent-history.ts`, and existing Stand/Entity/Agent history tests.

Install BC filters before BC readiness and Server filters before listening.
Apply BC filters once at each public/internal BC read boundary and Server
filters once when Entity or App Query domain output leaves its gRPC services.
Carry child read and enclosing AppQuery together. Do not infer a BC for final
R or rerun BC policies on a Server replacement. Audit all read façades, including
direct Stand reads and retained Entity/Agent state/Event history. Filter history
items without changing original cursor/continuation; do not filter internal
hydration/restoration/replay or persistence maintenance.

**Acceptance/tests:** BC-only, Server-only, both, repeated same-instance
installation, two BCs and two Servers; App Query source reads versus final R;
direct server.query excludes Server filters; Entity null removes a result,
whole R null yields zero entries, empty R remains one. Public history pages may
be empty with an unchanged continuation. Stored state, Event history used by
runtime, hydration, and caller-retained objects stay unchanged. Test async
concurrent contexts and failures. Gate read/history suites and
API/style/reliability review.

## M13 — Filter Entity and Event subscription deliveries

**Depends on:** M04, M08, M11–M12. **Class:** high-risk concurrency/lifecycle.
**Paths:** `stand/{stand,subscription-runtime,subscription-observer}.ts`,
`services/spine-services.ts`, managed-child/coordinator/browser delivery seams,
and native/client/BC subscription tests.

Evaluate original Topic matching first, BC filters next, Server filters at
gRPC output. Preserve original Entity ID/version independently of mutable
state; root null emits existing `no_longer_matching`, and prior removal notices
pass through. Filter Event domain payloads as roots, repack into the original
envelope, retain ID/delivery metadata, suppress only that consumer's null
Events, and omit all-removed data batches without losing control signals.
Preserve each grouped Event child's BC/context. Use existing bounded queues
with serialized per-consumer async filter work; cancellation prevents later
delivery, and filter errors terminate the affected stream.

**Acceptance/tests:** two consumers with fresh distinct Topics receive isolated
views; ID edits still remove original identity; nested edits deliver state;
stored/dispatched Events remain original; BC+Server order and each boundary's
single application hold. Slow async filters preserve order and bounded work;
cancel races stop delivery; errors never reveal unfiltered values. Re-run
unknown activation recovery: Entity authoritative results are filtered and
Events report gaps without invented replay. Test native/browser/fan-out paths
and control acknowledgements. Gate subscription and recovery suites plus
API/style/reliability review.

## M14 — Consumer examples, migration, and release readiness

**Depends on:** all prior slices. **Class:** high-risk integrated release.
**Paths:** current example startup and model package manifests (including
Message Board); a small multipackage example under `examples/` with model and
handler dependencies; `docs/USER_GUIDE.md`, relevant package README/REFERENCE,
example guides, `build-protocol/{TECHNICAL_SPEC,DEVELOPER_API}.md`, API snippets,
package/build/container checks, and existing task records.

Demonstrate the approved handler/filter APIs, internal execution, trusted
context, and migration from registry roots and in-response Query errors.
Compile single-package, split model/app, dependency-handler/app-builder, and
one-BC/multiple-package arrangements. Include generated Q/R browser-only imports
and a packed/bundled app proof. Update current governing claims without
rewriting historical completed-task evidence. Keep all generated artifacts
ignored; examples must use real domain fixtures and no authored optional Proto.

**Acceptance/gates:** deterministic docs/snippets/export/API-prohibition and
generated checks, all affected examples, package consumers, required coverage,
and complete specialist dispositions. Aggregate the final integration findings,
resolve accepted defects, then run final security review. Run the mandatory
cheap preflight before one `pnpm verify:release` after convergence; reuse
prepared build/generation evidence instead of duplicate full runs. Any new
behavior change after this gate requires its focused checks and risk-based
verification disposition.

Before review readiness, select an unused common workspace version and create
the required version-only commit with exactly `Bump version -> <version>`;
manifest top-level versions only. Put dependency pins/lockfile changes in a
separate commit. The authorized orchestrator promptly pushes feature commits
to official origin, including checkpoints/corrections; no PR, master write,
merge, force push, or shared-ref deletion is authorized.

`.github/workflows/build.yml` currently triggers only on pull requests to
master. A branch push alone cannot produce that Build/trial-publication result.
Record final-SHA CI results that actually exist and this explicit operational
limitation; do not create a PR, alter workflow triggers, or claim Build CI passed
to remove it. Local completion evidence and remote branch readiness remain
reportable with that limitation.

## Cross-slice risks and exclusions

- The validator repair must reach installed consumers, including application
  schemas registered after core initialization. Workspace-only patches or
  parallel validator registries fail acceptance.
- Metadata imports must not start applications; browser model imports must not
  pull handler classes, Server code, or bootstrap registration into clients.
  Package identity, constructor identity, and Proto conflict diagnostics are
  distinct checks.
- Existing direct/history APIs share storage with persistence internals. Capture
  their read boundary precisely; do not redact storage and accidentally alter
  restoration, transactions, or domain Event dispatch.
- Trusted identity is separate from ActorContext. Capture it per invocation
  and per subscription; no mutable current-user field or process-wide active
  handler/policy registry.
- Filter failures are technical failures; removals are successful filtered
  results. Preserve this distinction for empty lists, history continuation,
  Entity removals, and Event suppression.
- Required context enforcement will reveal old minimal fixtures. Correct those
  fixtures and clients; do not weaken Proto rules or reuse unrelated messages.
- No new query engine, generic context hierarchy, AppQueryDefinition, marker
  option, annotations, server-environment query registration, runtime filesystem
  scan, client global cache, delivered-ID ledger, Event replay, automatic
  masking/redaction convention, output-state validation, or provider polling.

No product or architectural blocker was demonstrated during this decomposition.
The dependency integration and forwarding changes are implementation risks with
specific proofs above, not reasons to pause the approved work.

### Pinned Proto source gate

`filters.proto` and `query_service.proto` currently appear in `sources` in
`packages/proto/proto/spine-sources.json` with upstream revision and checksum.
`scripts/verify-proto-sources.mjs` currently accepts copied-source or locally
authored-source entries, without an explicit local-override form. Do not simply
replace a copied-source checksum while continuing to claim untouched upstream
bytes. Record the approved local adaptation with original upstream provenance
and digest, local digest, and the narrowly authorized delta; extend the verifier
and its tests only as needed to represent and enforce that distinction. Do not
move unrelated copied contracts or weaken their checks.

Before changing frozen descriptor compatibility expectations under
`compatibility-tests/jvm/`, prove that the `TargetFilters` delta changes only
the deprecated constraint option to its supported equivalent, preserving every
existing field number/type and either/or semantics. Prove separately that the
QueryService delta adds Execute and its new message closure while preserving
Read and all existing signatures. Keep the original JVM baseline, explicitly
account for these approved TS extensions, and retain detection of unrelated
descriptor changes. New `app_query.proto` has local-source provenance.
An equivalent shared-adapter treatment of the legacy constraint can support an
intermediate checkpoint if necessary, but must be recorded as such; it does not
silently replace the approved final declaration migration.
