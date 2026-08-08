# T-0143: Wave 8 Documentation Convergence

Status: In progress from integrated Wave 8 implementation base.

## Objective

Align every current public and governing documentation claim with the stabilized
Wave 8 storage, delivery, validation, provider, and example runtime.

## Classification

Standard documentation task. The change is prose-, diagram-, snippet-, and
deterministic-check focused; it introduces no runtime subsystem or serialized
contract.

## Acceptance

- Current READMEs, REFERENCES, USER_GUIDE, architecture/API guides, diagrams,
  and governing specifications contain no stale shared layout, fingerprint,
  receipt, claim, attempt/exhaustion, quarantine, revoked-session, versioned
  discovery-key, old validation-package, or false atomicity claim.
- Documentation teaches direct per-record layouts, `StorageGroup`, provider
  customization, structural validation, `DeliveryMonitor`, shard ownership,
  delivered-row deduplication, lost-acknowledgement redelivery, downstream
  idempotency, and the no-migration cutover in beginner order.
- Historical task plans, decisions, reports, handoffs, and compatibility source
  evidence remain unchanged and are excluded explicitly from current-claim
  scans.
- README-to-REFERENCE links, audience statements, USER_GUIDE navigation,
  commands/paths, Mermaid diagrams, snippets, and Markdown links pass their
  deterministic checks.
- Final verification is `pnpm verify:task -- --no-tests` after review
  convergence.

## Ownership

- Current documentation and governing records only; no production code or
  historical-record rewrites.
- The orchestrator is the sole documentation writer.
- No replacement persistence or compatibility guidance may be invented.

## Review Dispatch

- Documentation: existing `documentation_reviewer`, immutable configured
  `gpt-5.6-luna` / `medium`.
- TypeScript/API documentation: existing `typescript_api_docs_reviewer`,
  explicitly `gpt-5.6-terra` / `high`.
- Performance/reliability: existing `performance_reliability_reviewer`,
  explicitly `gpt-5.6-terra` / `high`, limited to provider, transaction,
  delivery, and idempotency claims.
- Style/maintainability: N/A because production code is unchanged and prose
  style is owned by documentation review plus deterministic formatting.
- Security: N/A unless a correction changes an active authentication trust
  boundary claim.
