# T-0213 — Security and release closure

**Status:** Release-plumbing correction implemented; focused verification in progress

**Baseline:** `origin/main@4c28e2223b89fb203709413400770944778c071c`

## Classification

High-risk final-release milestone. It reconciles the repository-grounded threat
model after the T-0212 deletion, runs the one project-wide security gate,
closes current release documentation/status records, and produces native full
release evidence. It must not invent new deployment/runtime concepts.

## Known deployment assumptions

- Spine TS is a framework; framework-user applications determine their data
  sensitivity and internet exposure.
- The accepted production topology has a front-facing Gateway, one or more
  managed nodes, complete application replicas in child processes, shared
  storage and Delivery, and process-local IntegrationBroker channels.
- Coordinator, Delivery, storage, and provider discovery endpoints are
  deployment-internal unless a framework user exposes them.
- Multi-tenancy is supported and tenant isolation is security-critical.
- Authentication/authorization policy is application/deployment-owned through
  the framework's documented extension points; the threat model must not claim
  a universal built-in identity provider or TLS termination.

## Accepted outcome

- Replace the stale pre-T-0212 threat model with a repository-grounded current
  model covering runtime, build/release, examples, assets, trust boundaries,
  attacker capabilities, abuse paths, mitigations, and residual assumptions.
- Run the approved lockfile/dependency audit and classify findings by runtime,
  development-only, reachability, and disposition.
- Complete the dedicated final security review; fix confirmed findings by
  trust boundary and re-review until clean or until a real residual risk needs
  human acceptance.
- Reconcile current architecture, release matrix, completion plan, task/status
  mirrors, supported examples, explicit first-release exclusions, and release
  commands. Remove the obsolete local-multi-process acceptance requirement.
- Pass the native full release gate, required real smoke/Compose/package/docs
  checks, generated-clean checks, and global coverage requirement.
- Complete the final style, documentation, TypeScript/API, and reliability
  release-review wave; integrate, post-merge verify, push `main`, and remove the
  task branch/worktree.

## Non-goals

- No Gateway-hosted Integration Hub for physically split applications.
- No replacement for deleted ZeroMQ/generic signal routing.
- No platform-level autoscaling, TLS, identity provider, secrets manager, or
  observability product.
- No automatic process or shard-count selection.

## Release-plumbing correction

- `verify:release:generated` runs one global coverage-enabled Vitest command;
  it neither excludes nor separately invokes the deleted integration-broker
  cross-process test.
- The removal guard rejects resurrected broker cross-process and Todo local
  multi-process paths or current references.
- The Todo package no longer depends on the retired transport package. Its
  current guidance distinguishes single-process development from a deployment
  configured with managed complete application replicas, Coordinator forwarding,
  and direct Delivery observation.
