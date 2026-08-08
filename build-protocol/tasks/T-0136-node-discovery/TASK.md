# T-0136: Node Discovery Persistence

Status: Complete and reviewed; awaiting stacked integration

## Objective

Migrates application-node discovery from the obsolete private versioned lease
record to the approved `spine.deployment.ApplicationNodeLease` record and the
current `RecordSpec` contract.

## Classification

Standard, serialized-contract-sensitive. The approved Proto already exists and
the task changes one persistence family plus its provider customization path;
it does not design a new subsystem or public query API.

## Baseline And Ownership

- Baseline: pushed T-0135 commit `74a3c17f`.
- Branch: `task/T-0136-node-discovery`.
- Worktree: `.worktrees/T-0136-node-discovery`.
- Primary ownership: `packages/deployment/**`, the obsolete private deployment
  Proto removal, focused provider-customization tests, and T-0136 records.
- Preserve unrelated files. Do not edit JVM code, add migration readers, or
  reintroduce versioned keys/encoding metadata.

## Behavior Acceptance

- Persist the approved `spine.deployment.ApplicationNodeLease` directly.
- Use `spine.server.NodeId` as the stable storage ID and
  `spine.deployment.NodeRegistrationId` as the fencing identity.
- Round-trip endpoint, optional TLS server name, expiry `Timestamp`, node ID,
  and registration ID without primitive persisted-ID substitutes.
- Use the current `RecordSpec` source/record/ID contract with no storage key,
  fingerprint, encoding version, compatibility reader, or alias.
- Preserve atomic compare-and-set registration, renewal, removal, bounded
  cleanup, paging, cancellation, closure, and validation behavior.
- Prove MySQL table customization and Datastore layout/custom-storage
  selection can address the node-discovery record family.
- Delete
  `packages/proto/proto/spine/system/deployment/application_node_lease.proto`
  and every generated/stale reference through the normal Proto workflow.
- Update deployment README, REFERENCE, guide references, and stale-string tests
  to describe the current record in beginner-readable terms.

## Verification And Review

- RED baseline: deployment build reaches the one legacy `RecordSpec.schema`
  caller after generated dependencies are prepared.
- Required focused tests cover Proto round-trip, fencing, expiry, lifecycle,
  provider customization, and stale old-record absence.
- Required reviews: documentation, TypeScript/API docs, and
  performance/reliability. Style receives a concrete disposition if production
  structure changes. Security is N/A unless a trust boundary is introduced.
- Run the focused coverage-enabled `verify:task`; stacked downstream failures
  are recorded without restoring removed compatibility APIs.

## Implementation Assignment

- One existing `implementer` owns the bounded implementation and focused tests.
- Expected dispatch: `gpt-5.6-terra` / `medium`, explicitly supplied.
- The owner must not spawn subagents, commit, push, merge, edit JVM code, or
  modify unrelated downstream consumers.
