# Tenant and authentication storage

## Current example revision

[EXAMPLES.md](EXAMPLES.md) records the human-approved Orders and Fieldnotes
implementation and Message Board baseline restoration on this same PR branch.
It supersedes earlier Message Board demonstration requirements.

## Implementation specification

### Current review corrections

The standard Next.js MapLibre worker integration resolves the package worker
through `new URL(..., import.meta.url)`. The manual copy script and lifecycle
hooks are removed, and the license notice is retained. The actual Fieldnotes
browser flow passed in development and production. The project Timestamp
naming rule is now `when_` for every Timestamp field.

The human approved the following correction wave on 2026-11-09. These
requirements supersede conflicting statements in the earlier proposal:

- Implement immediate ordinary durable Inbox delivery, including one process
  with one shard. Routing accepts persisted recipient messages without waiting
  for recipient handlers. Startup and watchdog scans invoke the same delivery
  path. Remove `replay` terminology from ordinary delivery APIs and code.
  Preserve independent writes and the existing failure boundaries, without an
  outbox, cross-record transaction, or automatic saved-Event republication.
- Remove the Better Auth integration completely after an independent inventory.
  Preserve its failed implementation attempt and unresolved issues in a detailed
  future task. Retain direct Google OIDC, Firebase, opaque-session and signed-token
  support. A fresh independent reviewer must verify removal completeness.
- Implement Fieldnotes ordering by the domain Timestamp `when_created`, newest
  first, remove and reserve `place_key`, and rename other Timestamp fields with
  `when_`. Use full Timestamp precision without a technical ordering column.
- Do not implement the Command-outcome subscription protocol change in this
  task. Record a future proposal explicitly marked **NOT APPROVED YET** and
  explain several practical transport alternatives for the example.
- Review delivery and ordering through fresh no-memory reviewers and address
  relevant findings. Update human and agent documentation. Return the complete
  updated PR description in chat, preserving unrelated sections and describing
  the final features without a removal/scope-change narrative.

The supported single-host logout behavior remains unchanged. The human has
instructed the agent not to wait for CI during this correction wave. Local
verification, independent review, commits and immediate origin pushes remain
required. GitHub PR and Issue edits are not authorized.

[PROPOSAL.md](PROPOSAL.md) is the controlling specification for this task. Use it during implementation and review. Earlier chat drafts and experimental proposals are superseded where they differ. The human authorized production implementation on 2026-11-04. Implementation proceeds in feature/tenant-auth-storage from official master c3efab85c11abb95d351557053bace49a3310c54. Preserve the existing approved business-storage lifecycle.

## Human-Imposed Requirements Ledger

1. Work in a separate feature worktree from freshly fetched official origin/master; keep master intact. No codex branch, personal fork, migration, or unauthorized GitHub publication.
2. SINGLE_TENANT is default and may be explicit; no index instance or catalog access in that mode. Multi-tenant applications supply an index. Preserve existing setting optionality.
3. The sole standard tenant implementation is PersistentTenantIndex. Auth persistence is in the existing auth package.
4. New persistent stores have private constructors and async create factories; no ready method. Latest human decision: createMissingStructures is optional and defaults TRUE. Factory awaits supported missing-structure creation and compatibility checks; failure rejects. Explicit FALSE skips schema checks/creation during construction and later data operations. This supersedes older false-default proposals.
5. Existing business storage behavior is explicitly unchanged. Bounded Context build flags independently defer eager preparation/monitoring until first valid input. Existing runtime and ServerEnvironment create/check APIs remain.
6. Existing tenant, identity and session data sources remain replaceable. Select only required record families; no duplicate external directory or session store. Authentication and subscription records are distinct.
7. Explain separate Gateway, combined process, direct native admission and future replicas. A separate Gateway requires no Bounded Context or ServerEnvironment to construct auth stores. No actual Gateway replication in this task.
8. Logout stops local active streams immediately/best effort; durable failures are reported; no distributed-cancellation claim.
9. Cleanup is an explicit application-invoked API with application-selected timing/cutoff; no automatic scheduler or retention default. No audit-log feature implied.
10. Prefer maintained libraries for retained authentication paths.
11. Complete final English proposal with before/after, code, diagrams, library configuration and all selected scenarios; raw copy-pasteable Markdown in chat. Independent no-memory review and accepted findings addressed.
12. Use this final proposal when implementing. If actual provider/library evidence requires a material contract change, revise the specification and review that change before implementing a different contract.

13. Governing invariants: domain-correct Protobuf messages and complete IDs; explicit clock and cancellation contracts; unchanged accepted Entity transaction/handler APIs; no unapproved limits, migrations or compatibility-only paths. Keep provider queries indexed rather than whole-group filtering.
14. Document authored Proto messages/fields and production/example TypeScript types/methods with declaration spacing and semantic TSDoc. Keep package README/REFERENCE and user workflows accurate.
15. Run focused behavior tests before implementation, cheap preflight before relevant independent review, address accepted findings, and run final release verification with required coverage. Record full human-ledger dispositions in review.

## Implementation sequence

1. M1 — Per-handle preparation in common storage and built-in providers.
2. M2 — Persistent tenant registration, atomic first registration and indexed traversal.
3. M3 — Explicit single-tenant marker, environment and Bounded Context admission/callers.
4. M3A — Declared physical record indexes and exact indexed traversal prerequisites.
5. M4 — Persistent opaque sessions, sealed credentials and atomic generation changes.
6. M5 — Persistent OIDC transactions/grants and openid-client protocol integration.
7. M6 — Signed-token revocations and jose compatibility.
8. M7 — Browser credential admission, cookie handling and exact auth routes.
9. M8 — Operation lifetime, local invalidation and component deployment scenarios.
10. M12 — Provider/process acceptance, public documentation/examples, packaging and final gates.

## Current implementation status

M1, M2, M3, M3A, M4, M5, M6, M7 and M8 are implemented and accepted after
focused verification and independent review. Persistent opaque sessions, OIDC
state and signed-token revocations use the reviewed library composition and
factory lifecycle. Browser admission and native reader operations now capture
session facts and stop local forwarding on logout, expiry or shutdown, with
cleanup and failure visibility verified at asynchronous completion boundaries.
M12 adds executable tenant and authentication examples, documented
Gateway/native process placement, and the retained authentication provider
matrix. Its earlier implementation and independent reviews, including the
security review, are complete. The current correction wave is pending focused
review and repository-wide verification. The human explicitly waived waiting
for CI in this wave. Creating a pull request requires explicit authorization.

## Acceptance

The proposal's acceptance criteria govern all retained slices. Tests must cover
omitted and explicit true preparation, explicit false with missing/existing
structures, selected record families only, incompatibility, shared-factory
isolation and unchanged business eager/lazy behavior.

## Correction wave: Better Auth removal

This standard runtime and public-contract correction was implemented in
`feature/tenant-auth-storage` by the existing implementer role configured as
`gpt-6-sol` with medium reasoning. The pre-removal inventory confirmed the
optional subpath, its domain-specific Proto record, package dependency, tests,
documentation, and API-doc checks. Its failed attempt and unresolved issues
are retained only in the [future Better Auth task](../better-auth-integration/TASK.md).

The correction removes the optional auth source and tests, its Proto record and
generated export, two dedicated server tests, package export and dependencies,
and active public claims. Direct OIDC, opaque sessions, signed sessions, and
their provider tests remain. Proto generation, TypeScript build, retained auth
and server tests passed locally. The removal review, final release profile,
coverage, and integration status are pending in the wider correction wave.
