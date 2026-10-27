# Environment lifecycle implementation

## Current state

Started 2026-10-27 from official master ff6c866 on `environment-lifecycle`.
Dependencies installed with the frozen lockfile; Node 24.18.0, pnpm 11.9.0.
Proto generation and baseline build typecheck passed. Focused baseline tests passed: 50 tests in three files (Inbox records,
shard sessions, repository history cache). Generation refreshes tracked generationId stamps from UUIDs to
content hashes; these baseline-only differences are separated from feature work.

Architecture assignment: existing requirements_splitter application_architecture,
explicit immutable gpt-6-astra/high from its original dispatch, reused for one
implementation-boundary pass. Runtime introspection is unavailable. Scope:
sequence the accepted task and bound the first Storage-retention milestone.
No child delegation. No implementation or review result has been accepted yet.

No external dependency is needed for retention. Existing Storage interfaces and
JVM-style instance fields provide the required lifecycle. Full release verification
is reserved for the converged runtime task; focused checks run between milestones.

First bounded implementation assignment: existing implementer role,
`gpt-6-sol` / `medium` explicitly selected. Scope: repository retained Entity
storage lookup before construction, plus focused behavior tests and relevant
TSDoc. Only repository.ts and repository test files may be changed initially.
Inbox/shard lifetime changes await the architecture shutdown outline. Acceptance:
repeated and concurrent repository use creates one successful store per tenant
and model; failure leaves creation retryable; repository close releases retained
resources; existing state/history behavior remains. Runtime metadata is unavailable
unless surfaced by the child; configured dispatch fields are the acceptance evidence.

Architecture first-slice result accepted under confirmed configured Astra/high;
no separate runtime metadata exposed. Repository cache lookup and partial resource
cleanup can land independently. EventStore retention follows using its existing
close lifecycle. Inbox/shard retention must be implemented with Delivery lifetime
and shutdown, since per-signal Delivery construction currently has no close chain.

Baseline tooling typecheck, documentation audience checks and git diff checks passed.
The first implementation slice is producing focused red/green regression evidence;
its independent review remains pending. Generated stamp refreshes are not part of
that slice and will not be staged with its source changes.

The sole architecture pass is complete and accepted. The configured existing
requirements_splitter confirmed gpt-6-astra/high; runtime introspection unavailable.
MILESTONES.md records the ordered execution plan. Agent recovery removal is a
hard prerequisite for new shared saved-work scanning. Inbox/shard retention must
land with the full shared Delivery close chain; EventStore retention can proceed
using its existing explicit lifecycle.

Repository slice authoring completed: implementer storage_retention, explicit
configured gpt-6-sol/medium confirmed; actual runtime metadata unavailable. Changes
are limited to repository.ts and repository-routing.test.ts. Reported evidence:
334 focused tests and server typecheck/ESLint/cleanup/TSDoc/format passed. Primary
inspected the diff. Acceptance awaits mechanical changed-branch coverage and review.

Mechanical pre-review assignment: orchestrator-dispatched function,
gpt-6-luna/low explicitly selected, no new project role. Inspect the frozen two-file
slice, run cheap preflight and changed-line/branch coverage; record outputs outside
version control. No source edits or child delegation.

EventStore retention is assigned next to the same implementer, immutable explicit
gpt-6-sol/medium. Scope: packages/storage/src/event/event-store.ts and its event
store tests only. The repository diff remains frozen for read-only checks. These
small retention patches form one coherent review package; no review findings will
be corrected before the complete review wave. Acceptance: one RecordStorage per
captured tenant/group, no per-operation close, retry failed creation, close every
retained store once even on failure, reject use after close, keep factory open.

Independent repository preflight passed: 334 routing tests, changed-file format,
ESLint, server typecheck and diff checks. Mechanical function gpt-6-luna/low
confirmed configured profile; no runtime metadata available. Its first coverage
summary was rejected because extraction truncated the wrong LCOV section. Exact
section parsing corrected the report: cache reuse and common cleanup are covered;
Agent-port acquisition rollback and multiple-error aggregation need behavior tests.
The misspelled requested history-cache path did not run; do not count it as evidence.
These mechanical gaps were returned to the existing implementer before review.
