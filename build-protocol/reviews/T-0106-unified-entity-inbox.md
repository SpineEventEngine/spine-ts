# T-0106 Review Record

Status: Final Corrections Required

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

- Style/maintainability: corrections ready for final re-review; generic command
  handoff now uses Entity Inbox terminology while PM event helpers remain PM-named.
- Documentation: corrections ready for final re-review; README/REFERENCE use a
  complete public `BoundedContext.singleTenant(...).withDeliveryStrategy(...)` example.
- TypeScript/API docs: corrections ready for final re-review; the builder example
  now matches the public API.
- Performance/reliability: clean after correction re-review.
- Security: N/A unless implementation changes a trust boundary.

## Correction Checkpoints

- `8b7bf68a` is the pushed RED checkpoint for findings 1, 3, and 8. The focused
  stateful routing assertion observed six `shardFor` calls for three inputs.
- `c28f4647` is the pushed GREEN checkpoint. It reuses the routed shard for
  local drain replay while retained descriptor replay resolves and validates a
  stored shard. Focused Entity Inbox/context/repository evidence is 226/226.
- `9e6725a8` and `4e9e76ba` complete the generic ownership names, public
  documentation/TSDoc, and narrow explicit-`undefined` replay contract.
- Finding 8 descriptor evidence is ready for re-review: focused
  `bounded-context.test.ts` coverage uses durable low-level Inbox rows and the
  real bounded-context descriptor to prove valid nonzero-shard Aggregate,
  Process Manager command, and Process Manager event replay; forged Aggregate
  and PM stored shards reject before handler-visible state changes; and a fresh
  same-storage descriptor enumerates all configured PM shard/label endpoints
  and replays every pending row once. The focused suite passes 55/55. This does
  not close any review lane; deterministic preflight and affected reliability
  re-review remain required.
- `dee30db1` is the final correction endpoint before record reconciliation.
  The complete bounded preflight passes generated/build/tooling typechecks,
  ESLint, cleanup, TSDoc, format, documentation/API, Proto, generated
  cleanliness, release readiness, and 229/229 focused tests. All four affected
  concerns require one re-review against this correction set.
- Re-review at `f6a43e89` accepted reliability completely and accepted all
  style/API/documentation findings except two deterministic P2 corrections:
  finish generic naming on the shared command tenant/context helpers, and use
  `BoundedContext.singleTenant(...)` in the README/REFERENCE strategy example.
