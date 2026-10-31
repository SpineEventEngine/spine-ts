# Remaining App Query and read-side filter work

The [approved proposal](PROPOSAL.md) and [requirements ledger](TASK.md) remain
binding. Shared validation, Command/Event admission, read-service status mapping,
unknown-subscription activation, and passive local metadata migration are
implemented, including dependency discovery, App Query generation, trusted reader
forwarding, retained subscription reader binding, Server App Query execution,
typed clients, Execute transport support, and filter installation on outward
Entity/App Query reads, retained histories, and native Entity/Event subscription
deliveries. Remaining work follows below.

Each slice includes focused behavior tests, affected generated/build checks,
format/lint/TSDoc checks, coverage inspection and the relevant existing review
concerns. Use the existing implementation context for corrections and collect
one review wave before returning a correction batch. Keep detailed evidence
outside Git. Run the unchanged full release profile and final security review
after integration converges; a slice checkpoint does not complete this task.

## M13 — Complete direct Stand subscription filtering

**Depends on:** M04, M08, M11–M12. **Class:** high-risk concurrency/lifecycle.
**Paths:** direct Stand subscription delivery and its repository notification
callers, affected declaration/behavior tests and migration documentation.

Native RPC subscriptions now admit original matched updates to their existing
queue before BC and Server filtering. Entity null uses the original ID in
`no_longer_matching`; Event null suppresses only that consumer's payload, with
surviving envelopes and control messages preserved. Activation carries the
verified reader and actual subscription/Bounded Context. Cancellation, source
replacement/removal, overflow and policy faults invalidate pending delivery.

Direct Stand subscriptions have no existing delivery queue or removal/error
contract. Their asynchronous admission policy needs a human decision under the
repository's prohibition on new artificial limits. The proposed per-consumer
queue of 100 waiting updates plus one active update is not approved. The
alternative changes producer completion and backpressure. Do not introduce the
new capacity without approval. Other independent work can continue.

After that decision, provide filtered state/removal delivery with original
identity/version/tenant, separately filtered previous state, a terminal error
channel and cancellation. Keep raw repository notifications private. Filters
apply to outward data, without changing persistence or domain Event dispatch.
Test independent consumers, FIFO processing, cancellation and late settlements,
first-update removal, previous-state suppression, fault isolation and the chosen
admission policy. Update affected examples and direct subscription migration
instructions. Complete API/style/reliability review of this remaining contract.

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

The maintained multi-package example, migration guides, installed/bundled
consumer checks, and actual image build/runtime checks are complete. Workspace
versions are aligned at `2.0.0-snapshot.26`; the version-only commit is separate
from dependency pins, lockfile, and generated metadata updates. Remaining work
is direct Stand filtering and its migration guidance, followed by final security
review and the full release gate. The authorized orchestrator promptly pushes
feature commits to official origin, including checkpoints/corrections; no PR,
master write, merge, force push, or shared-ref deletion is authorized.

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

The direct-subscription admission decision above is the remaining product
question. It does not block RPC subscription filtering or other independent
implementation and verification work.

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
