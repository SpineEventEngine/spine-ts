# T-0080K: Remediate the Chat application and web client

## Status

Planned.

## Parent And Dependencies

- Parent: T-0080.
- Depends on: T-0080F, T-0080G, T-0080H, and T-0080J.
- Required by: T-0080O.

## Objective

Complete TSDoc, name, and behavior-ownership remediation in the Chat server app
and React web client, and finish the family README against the stabilized code.

## Classification

High-risk where authentication, subscription, browser/React lifecycle, or
public example workflow code moves; otherwise standard.

## Human-Imposed Requirements Ledger

- Exported example declarations/public members have complete concise TSDoc.
- Callable summaries start with a third-person verb; parameters and non-void
  results are documented.
- Authored TypeScript names have at most four semantic components.
- Standalone behavior moves to cohesive named owners or receives an exact
  necessity disposition.
- Chat uses Projection entities and `client-react`.
- Best-effort subscription updates retain reconnect/re-query behavior and no
  completeness promise.
- The family README covers the complete application accurately.
- End-user API prohibitions remain enforced.
- No generated edit and no Spine JVM build.

## Ownership

- `examples/chat/app`, `examples/chat/web`, the family README, their tests, and
  their quality partitions.

## Acceptance Criteria

1. Owned authored TypeScript has zero TSDoc/name debt and exact standalone
   dispositions.
2. Moved behavior remains cohesive with existing application, auth, client, or
   React owners; no `Utils`/facade dumping ground is introduced.
3. Command, query, subscription, authentication/session, reconnect/re-query,
   React Strict Mode, browser transport, and server shutdown behavior remain
   equivalent.
4. End-user handler and API prohibition scans remain clean.
5. The family README commands work from the nested layout and accurately cover
   generation, start, browser use, auth topology, commands, queries,
   subscriptions, tests, and known best-effort limitations.
6. Focused app black-box, web unit/browser/interop, auth, and lifecycle tests
   pass.

## Exclusions

- No new Chat feature, auth provider, browser protocol, delivery guarantee, or
  deployment topology.
- No Proto/model rename after T-0080J except a blocker correction returned to
  that owner.
- No final repository-wide generation/full gate.

## Verification And Review

- Focused Chat app/web/browser/interop tests, clean Chat generation/build,
  end-user API scans, TypeDoc/docs command checks, lint/format, checker
  partitions, generated cleanliness, and `git diff --check`.
- All four canonical concerns are relevant because public prose and
  lifecycle-sensitive application/browser behavior are touched.

## Planning Dispatch

- T-0080K starts after pushed T-0080J merge commit `baef9891`.
- Because authentication, browser/React lifecycle, public example APIs, and
  subscription/reconnect behavior are high-risk boundaries, the existing
  requirements splitter is explicitly assigned `gpt-5.6-sol` / high.
- The splitter is read-only, may not spawn subagents, and must return an exact
  58-row TSDoc, 20-row standalone-function, one-row semantic-name, README,
  behavior-invariant, test, and bounded-writer plan.
- Both model and reasoning fields are explicit. Runtime metadata is recorded if
  exposed; otherwise the configured profile and limitation are recorded.
