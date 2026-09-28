# Process Manager queries across contexts

Status: Implemented and independently reviewed; local release verification passed.
GitHub CI awaits a human-created PR for this branch.
Date: 28 September 2026.
Branch: `cross-context-queries`.
Base: official `origin/master`, `2324311be8c23024f66cb2ba702fbe99a99e7dfb`.

## Human-Imposed Requirements Ledger

- A Process Manager query finds the context registering its target Entity by
  type URL, without an application-supplied context name. Keep `select()`.
- Search only contexts registered with the same `Server`; no remote discovery.
- Reject duplicate Entity type registrations across those contexts before
  processing begins. Name the type and both contexts in a simple error.
- Every operation has an effective tenant, including single-tenant operations.
  Follow the latest official JVM sources, not memory or old research notes.
- Preserve the triggering signal's tenant. Reject an incompatible destination
  before reading; never substitute its tenant. No tenant-switching API.
- A named tenant can query a multitenant context for that tenant, but cannot
  query a single-tenant context. `SINGLE_TENANT` can query a single-tenant context
  or its identically named partition in a multitenant context.
- Missing records are empty results, not tenant mismatch. Omitted wire tenant
  fields may remain valid in single-tenant mode; execution resolves the identity.
- Keep snapshot publication advancing only `snapshot`, not `latest`.
- No new dependencies, outbox, speculative infrastructure or unrelated repairs.
- Use simple documentation, comments in examples, and domain-correct Proto types.
  Retain framework `ProcessManager`; do not suffix application names with Manager.
- Document all classes/methods/generic parameters in touched authored production
  files, separate declarations with blank lines, and obey the 35-line callable
  limit and Proto layout rules. Never hide fixtures in encoded descriptors.
- Follow the current protocol's worktree, explicit model routing, immediate
  pushes, version-only commit, independent review and verification rules.
- Do not create or merge a PR, publish packages or change npm tags.

## Scope and design

This is high-risk work: tenant isolation and cross-context startup/shutdown
behavior change. The prior Astra/high architecture pass and fresh standalone
Sol/medium plan review are complete. No product questions remain.

Use common effective-tenant handling at existing execution/query/storage
boundaries. Do not create a Process Manager-only exception or rewrite persisted
partition keys merely to represent the effective tenant as a `TenantId`.
Single-tenant storage already has a distinct internal boundary.

Share a small internal type-to-context lookup with client query routing. Keep
registered schema, columns and context together; target registration governs
validation. Do not merge internal/public response formats or use loopback HTTP.
Install lookup before delivery recovery and update existing captured runtime
bindings. Standalone contexts retain local reads; separate Servers stay isolated.

Foreign targets require `query` or `full` visibility, checked before storage.
Existing local/public visibility behavior is outside this scoped correction.
Unknown, hidden and tenant-incompatible targets are errors, not empty results.
Preserve actor context, query predicates, masks, ordering, limits, lifecycle
filtering, cloned results and handler-scoped read-only access.

Startup duplicate validation and partial route installation belong inside
retryable cleanup for constructed contexts/resources. During shutdown, stop
admission and drain accepted handlers across every context before closing any
Stand. Reuse existing lifecycle operations, without a new lifecycle framework.

## Implementation sequence and acceptance

1. Add failing focused tests and implement common effective-tenant resolution.
   Prove named-tenant separation, single-tenant identity, omitted wire fields,
   mismatch before storage, and valid empty results.
2. Add shared target lookup and route handler reads. Prove all Entity families
   when queryable, local/foreign reads, standalone fallback, Server isolation,
   duplicate registrations in either order, visibility and unknown targets.
3. Connect startup and two-phase shutdown. Prove recovery sees complete routes;
   failed validation starts neither recovery nor listening and cleans up; a
   handler paused before querying another context completes during shutdown
   regardless of registration order. Preserve retryable close behavior.
4. Add a real two-context example and focused integration tests for command,
   event/rejection and restored Entity handler queries. Keep user-facing docs,
   package reference and TSDoc accurate about tenants and eventual consistency.
5. Run cheap preflight, collect all relevant independent review concerns, fix
   accepted findings, then run `verify:release` once after convergence. Inspect
   changed-source coverage and require at least 90% global coverage.
6. Bump all workspace versions to one verified-unused snapshot in a version-only
   commit, update pins/lockfile/docs separately, push every commit immediately,
   and verify exact remote state. Confirm final-SHA CI when a human-created PR
   exists; do not create one to bypass that restriction.

## Source evidence

Latest official JVM revision freshly fetched during analysis:
`ea3067b137938ac0beb6920c39d11e300976fcc9`.

- `tenant/SingleTenantIndex.java`, `TenantAware.java` and its operation tests:
  single-tenant execution resolves to `SINGLE_TENANT`.
- `TenantAwareRunner.java` is internal; operation/function bases are SPI, not
  ordinary application tenant-switching APIs (repository README policy).
- `query/QueryingClient.kt`, `procman/ProcessManager.kt` and repository configure:
  JVM handler queries stay local; requested cross-context behavior extends that.
- `stand/QueryValidator.java`: query visibility is required.
- `VisibilityGuard.java` and `TypeDictionary.java`: inspected guards are local
  and the public dictionary overwrites duplicates; do not claim a proven JVM
  server-wide rejection. TS server-wide rejection is the user's explicit rule.

The TS baseline binds PM reads to `runtime.stand`, public services build a
type-to-context map, and storage uses `TenantBoundary.single`. Server shutdown
currently closes contexts sequentially. The implementation must address these
specific paths, not invent a parallel query language or tenant framework.

## Estimate and review

Active work: 1.5–2.5 hours, plus CI waiting. Runtime and focused tests:
0.8–1.3 hours; example/docs: 0.2–0.4; preflight, reviews, corrections, release
verification, version integration and reporting: 0.5–0.8.

One Sol/medium implementer handles overlapping production/test/example files.
Existing style, API and reliability reviewers use Sol/medium; documentation
review uses Luna/medium. Mechanical verification uses Luna/low (medium for
classification). Final security review, if required at release acceptance, uses
Sol/high. No child spawns children. All dispatches explicitly name both fields.

The work log records skill checks, verification and remote state. The review log
records independent findings and all four canonical concern dispositions.
