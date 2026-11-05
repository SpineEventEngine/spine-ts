# Tenant and authentication storage

## Implementation specification

[PROPOSAL.md](PROPOSAL.md) is the controlling specification for this task. Use it during implementation and review. Earlier chat drafts and experimental proposals are superseded where they differ. The human authorized production implementation on 2026-11-04. Implementation proceeds in feature/tenant-auth-storage from official master c3efab85c11abb95d351557053bace49a3310c54. Preserve the existing approved business-storage lifecycle.

## Human-Imposed Requirements Ledger

1. Work in a separate feature worktree from freshly fetched official origin/master; keep master intact. No codex branch, personal fork, migration, or unauthorized GitHub publication.
2. SINGLE_TENANT is default and may be explicit; no index instance or catalog access in that mode. Multi-tenant applications supply an index. Preserve existing setting optionality.
3. The sole standard tenant implementation is PersistentTenantIndex. Auth persistence is in the existing auth package; optional Better Auth export is auth/better-auth.
4. New persistent stores have private constructors and async create factories; no ready method. Latest human decision: createMissingStructures is optional and defaults TRUE. Factory awaits supported missing-structure creation and compatibility checks; failure rejects. Explicit FALSE skips schema checks/creation during construction and later data operations. This supersedes older false-default proposals.
5. Existing business storage behavior is explicitly unchanged. Bounded Context build flags independently defer eager preparation/monitoring until first valid input. Existing runtime and ServerEnvironment create/check APIs remain.
6. Existing tenant, identity and session data sources remain replaceable. Select only required record families; no duplicate external directory or session store. Authentication and subscription records are distinct.
7. Explain separate Gateway, combined process, direct native admission and future replicas. A separate Gateway requires no Bounded Context or ServerEnvironment to construct auth stores. No actual Gateway replication in this task.
8. Logout stops local active streams immediately/best effort; durable failures are reported; no distributed-cancellation claim.
9. Cleanup is an explicit application-invoked API with application-selected timing/cutoff; no automatic scheduler or retention default. No audit-log feature implied.
10. Prefer maintained libraries. Preserve actual Better Auth-to-RecordStorage evidence and bounded support; no native SQL adapter substitution, arbitrary plugin claim or production-readiness claim from lab tests.
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
10. M9 — Optional Better Auth selected storage models and controlled provisioning.
11. M10 — Better Auth native session/password/external-login integration.
12. M11 — Better Auth native OIDC, single-use callback state and network cancellation.
13. M12 — Provider/process acceptance, public documentation/examples, packaging and final gates.

## Current implementation status

M1, M2, M3, M3A, M4, M5, M6, M7, M8 and M9 are implemented and accepted after
focused verification and independent review. Persistent opaque sessions, OIDC
state and signed-token revocations use the reviewed library composition and
factory lifecycle. Browser admission and native reader operations now capture
session facts and stop local forwarding on logout, expiry or shutdown, with
cleanup and failure visibility verified at asynchronous completion boundaries.
Selected Better Auth persistence now supports controlled provisioning, native
adapter operations and explicit maintenance. M10 native login and sessions is
next; M10 through M12 remain to be accepted.
The Better Auth public declaration and generated-route policy amendments have
accepted designs; their runtime implementation remains in the corresponding
milestones. Final repository-wide release verification and security review
remain in M12.

## Acceptance

The proposal's acceptance criteria govern all slices. Tests must cover omitted and explicit true preparation, explicit false with missing/existing structures, selected models only, incompatibility, shared-factory isolation and unchanged business eager/lazy behavior. The completed disposable experiment demonstrates feasibility; it does not implement these public APIs.
