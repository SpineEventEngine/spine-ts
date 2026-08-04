# T-0106 Review Record

Status: Corrections In Progress

## Review Assignments And Results

- Style/maintainability: existing `style_maintainability_reviewer`, explicit
  `gpt-5.6-terra` / `high`.
- Documentation: existing immutable `documentation_reviewer`,
  `gpt-5.6-luna` / `medium`.
- TypeScript/API docs: existing `typescript_api_docs_reviewer`, explicit
  `gpt-5.6-terra` / `high`.
- Performance/reliability: existing `performance_reliability_reviewer`,
  explicit `gpt-5.6-terra` / `high`.

All four lanes completed against `6926ff26` after deterministic preflight.
Every dispatch named its expected role, model, and reasoning. The documentation
role's Luna/medium profile is immutable and was selected explicitly; the active
surface exposes no Luna override. Runtime self-introspection is unavailable,
so immutable role profiles plus explicit dispatch fields are the accepted
actual-metadata evidence. No visible mismatch or fallback occurred.

## Accepted Findings

1. P1 style/reliability: one global follow-up promise blocks unrelated shards
   and tenants, while direct assignment can overwrite an earlier live tail.
   Key and chain live follow-ups by tenant/shard delivery scope, preserve causal
   re-entry, and remove settled map entries.
2. P1 reliability: replay does not verify that a stored row's shard equals the
   configured strategy result for its target ID/type. Reject mismatches before
   Aggregate or Process Manager handler invocation.
3. P2 style: one input resolves its shard repeatedly for coordination and
   persistence. Resolve once into an internal routed input and reuse it.
4. P2 style: generic ownership still uses PM-only registry/factory/tenant names.
   Rename shared command/Inbox paths to Entity Inbox terminology; retain PM
   names only for PM event behavior.
5. P2 API: README/REFERENCE name nonexistent
   `BoundedContext.withDeliveryStrategy(...)`; the method belongs to the
   builder chain.
6. P2 API: `EntityInboxReplay = Promise<unknown>` hides the optional async
   follow-up protocol. Model the two valid promise shapes explicitly without
   weakening the result or suppressing lint.
7. Documentation: distinguish Aggregate command handoff from Process Manager
   command/event handoff, and add the one-shard default plus a concrete
   `UniformAcrossAllShards.forNumber(...)` example to README, REFERENCE, and
   affected TSDoc.
8. Reliability coverage: add nonzero/mismatched-shard Aggregate and Process
   Manager replay coverage through the context descriptor and prove fresh
   multi-shard recovery. Add a gated two-drain regression for chained tails and
   a different-shard/tenant non-blocking regression.

## Current Dispositions

- Style/maintainability: corrections required for follow-up scope, shard
  resolution, and generic ownership naming.
- Documentation: corrections required for distinctions, default, and example.
- TypeScript/API docs: corrections required for API name and replay type.
- Performance/reliability: corrections required for shard validation,
  follow-up chaining/scope, and focused multi-shard coverage.
- Security: N/A unless implementation changes a trust boundary.

## Correction Checkpoints

- `8b7bf68a` is the pushed RED checkpoint for findings 1, 3, and 8. The focused
  stateful routing assertion observed six `shardFor` calls for three inputs.
- `c28f4647` is the pushed GREEN checkpoint. It reuses the routed shard for
  local drain replay while retained descriptor replay resolves and validates a
  stored shard. Focused Entity Inbox/context/repository evidence is 226/226.
- Naming and documentation corrections are in progress. The requested replay
  type needs a compatible no-`void` contract decision: strict tooling rejects
  both the explicit union of promise containers and a narrowed result union for
  existing callback implementations. Descriptor coverage and deterministic
  preflight remain in progress; no review lane is yet closed.
