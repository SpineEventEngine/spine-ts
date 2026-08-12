# T-0173: Delivery And Deployment Journey

Status: Implementation authorized and starting

## Objective

Rewrite delivery, deployment, GCE/GKE, distributed Message Board, and Envoy
documentation into a beginner journey from local execution to supported
distributed packaging, discovery, operation, and shutdown.

## Classification

High-risk documentation: distributed delivery, leases, acknowledgements,
topology, finite limits, shutdown, deployment, discovery, and failure behavior.

## Human-Imposed Requirements Ledger

- Scope is exactly the 13 T-0173 paths in the Wave 10 ownership table.
- Record `changed` or `reviewed-no-change` for every path; every TypeScript fence
  passes strict checking and all local links resolve.
- READMEs stay concise/preserve look and feel; references retain exhaustive
  topology, finite-limit, lifecycle, and operational contracts.
- Prose is beginner-paced, natural, and structured; avoid needless “own” forms.
- Teach local/remote delivery, combined/distributed packaging, containers,
  discovery, GKE/GCE operation, and orderly shutdown using current behavior.
- Explain durable Inbox rows, shard leases/fencing, redelivery/lost-ack behavior,
  idempotent effects, bounded reads/drains, and no attempt-history persistence.
- Describe only supported single-Gateway/fixed topology behavior.
  Multiple-Gateway is deferred; Cloud Run is outside the initial offering.
- Link exact provider/topology limits to one canonical reference rather than
  repeating dense matrices or inventing guarantees.
- T-0169 copyright and T-0170 strict snippet gates remain intact.

## Assignment

Single owner: existing `implementer`, explicit `gpt-5.6-terra` / medium. The
owner controls only the 13 T-0173 reader docs and records, uses no subagents,
and preserves unrelated work.

## Verification And Review

Run strict snippets on all 13 paths, links, topology/limit/deferral scans,
audience/API, format/copyright/diff, and `verify:task -- --no-tests`. Review
documentation, TypeScript/API, and performance/reliability. Style/security are
N/A absent tooling or security-boundary changes.
