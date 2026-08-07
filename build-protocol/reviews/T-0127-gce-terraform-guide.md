# T-0127 Review Record

Status: Implementation in progress

## Required Concerns

- Style and maintainability: Terraform module depth, startup example ownership,
  test durability, naming, and package shape.
- Documentation: beginner sequence, factual GCE claims, copyable commands,
  architecture, scaling/replacement/rollback, limitations, and troubleshooting.
- TypeScript/API documentation: registry/registrar/discovery examples, explicit
  application-owned collaborators, package exports/payload, and current APIs.
- Performance and reliability: lease timing, private reachability, autohealing,
  scale-to-zero/recovery, autoscaler ownership, rolling/stop-all replacement,
  Gateway interruption, and in-memory delivery limitations.
- Security: deferred to T-0128's Wave 7 release gate. Deterministic policy tests
  still require private application topology and external secret references
  without values in Terraform state.

## Review Dispatch Metadata

Recorded after mechanical verification and before reviewer dispatch. Terra
reviewers use explicit `gpt-5.6-terra` / `high`; documentation uses its immutable
`gpt-5.6-luna` / `medium` role with `medium` explicit.
