# T-0080G: Remediate auth and browser-client packages

## Status

Planned.

## Parent And Dependencies

- Parent: T-0080.
- Depends on: T-0080D.
- Required by: T-0080H and Chat web remediation.

## Objective

Remediate authored APIs and behavior ownership in `auth`, `client-web`, and
`client-react` while preserving authentication, browser transport,
subscription, and React lifecycle semantics.

## Classification

High-risk. These packages expose public contracts and include authentication,
session, cancellation, and long-lived browser/React resource boundaries.

## Human-Imposed Requirements Ledger

- Complete concise public TSDoc, third-person callable summaries, and
  parameter/non-void-result documentation are mandatory.
- Authored TypeScript names have no more than four semantic components.
- Standalone behavior moves to cohesive named owners or has an exact necessity
  disposition.
- React-specific `use...` names remain confined to `client-react`; Spine
  operations retain their accepted vocabulary.
- Existing authentication, authorization, session, redaction, cancellation,
  reconnect, gap notification, and cleanup semantics remain unchanged.
- No new auth topology, provider, or completeness promise.
- No generated edit and no Spine JVM build.

## Ownership

- `packages/auth`, `packages/client-web`, and `packages/client-react`, including
  owned tests/docs/quality partitions.
- Exact downstream imports for changed exports, serialized with other owners.

## Acceptance Criteria

1. Owned authored source has zero TSDoc/name debt and exact dispositions for all
   remaining standalone functions.
2. Public names remain provider-neutral, browser-safe, and aligned with accepted
   Spine operation vocabulary.
3. Moves preserve credential/session verification, trusted context
   reconstruction, per-request authorization, redaction, subscription
   ownership, cancellation, bounded relay behavior, reconnect/gap behavior, and
   React Strict Mode cleanup.
4. No Node-only dependency leaks into browser packages and no React dependency
   leaks into `client-web`.
5. Focused auth, browser dependency-boundary, subscription, and React lifecycle
   tests remain green.

## Exclusions

- No new provider, token/session format, browser protocol, React feature, cache,
  delivery guarantee, or security policy.
- No client-node or example semantic cleanup.
- No final shared export/generation reconciliation.

## Verification And Review

- Focused package tests, dependency-boundary checks, typecheck, package
  TypeDoc/export audit, lint/format, checker partitions, and
  `git diff --check`.
- All four canonical concerns are relevant because public auth/browser APIs and
  lifecycle-sensitive code are touched.
- Security remains the project final gate unless the human explicitly requests
  an earlier dedicated security review.
