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

## Implementation Acceptance

The pushed endpoint `597db7d5` contains the RED-first contract, GCE Terraform,
packaged typed entrypoints, human guide/reference, package payload, source
evidence, and the mechanical snippet correction. The original implementer was
explicitly configured as `gpt-5.6-terra` / `medium`; runtime
self-introspection was unavailable and no visible mismatch occurred.

Mechanical evidence is green: six deterministic Terraform/guide/package tests,
build and tooling typechecks, strict TypeScript documentation snippets, TSDoc,
Prettier, package archive inspection, Terraform formatting/validation, and diff
validation. The worktree and pushed branch are clean.

## Review Wave Dispatch

- Style and maintainability checks Terraform module depth/resource ownership,
  startup-example structure, deterministic policy tests, naming, package
  payload, and maintainability of future version/placement changes.
- Documentation checks beginner completeness and factual/copyable claims for
  private networking, internal passthrough load balancers, image startup,
  secrets, registration timings, scaling from zero, replacement, rollback,
  Gateway interruption, troubleshooting, and teardown.
- TypeScript/API checks the packaged registrar/discovery entrypoints against
  current public contracts, ownership/closure semantics, snippets, imports,
  package contents, and public wording.
- Performance and reliability checks managed-group/update/autohealing behavior,
  stable internal endpoints, startup/container failure handling, autoscaler
  metric semantics and ownership, scale-to-zero recovery, rolling versus
  stop-all operations (including enabled-autoscaler cases), registry expiry,
  and in-memory delivery limitations.

Style, TypeScript/API, and reliability reviewers are dispatched with explicit
configured `gpt-5.6-terra` / `high`. The documentation reviewer uses the
existing immutable `gpt-5.6-luna` / `medium` profile with `medium` explicit.
Runtime metadata is recorded if exposed; otherwise configured profile and
absence of visible mismatch remain the acceptance evidence.

## Review Wave Results

- Style and maintainability: P1, the required `REGISTRY_STORAGE_REFERENCE` is
  passed to both processes but ignored by the shipped entrypoints, so it cannot
  guarantee that application and Gateway resolve the same registry storage.
  P2, topology policy assertions use unanchored string/slicing checks that can
  be satisfied by comments or heredocs rather than real top-level resources.
- TypeScript/API: P1, the application entrypoint owns a registry but registers
  only the registrar lifecycle, leaking the registry storage handle. P1, the
  standalone Gateway stops scheduled discovery but never closes the registry;
  it needs a small package-owned discovery wrapper or equivalent lifecycle API.
  P2, the guide contradicts the actual storage-factory injection contract.
- Documentation: P1, stop-all replacement, incompatible rollback, and teardown
  do not first disable an enabled autoscaler, so old nodes can remain or return.
  P1, whole-group scale-from-zero omits `autoscaling_min_replicas = 0`. P2,
  metric-name wording incorrectly includes CPU, storage-reference resolution is
  unclear, and the beginner guide omits COS `docker run` startup/log behavior.
- Performance and reliability: P1, a fixed regional surge of one is invalid
  when the application MIG requires at least two zones; use the zone count.
  P1, custom metrics lack an explicit Monitoring filter/scope and independently
  selected target kind, so the documented whole-group zero-wakeup path is not
  represented. P1, Gateway and delivery groups lack deterministic proactive
  replacement policies/procedures. P2, Artifact Registry reader authorization
  and the health-check-repair implication of `docker run --rm` are undocumented.

All reviewers reported their configured roles/profiles. Runtime
self-introspection was unavailable, and no visible mismatch or fallback
occurred.

## Correction Batch Dispatch

The original implementer receives the complete accepted batch as one pass:

1. Read `REGISTRY_STORAGE_REFERENCE` in typed settings and require an
   application-owned resolver that maps it to a `StorageFactory` in both
   entrypoints. Register the application registry as a Server resource.
2. Add a small production `deployment-gce` discovery owner that combines
   `GceRegistryReader`/scheduled discovery with closing its owned registry when
   the browser server stops. Use and directly test it in the Gateway example;
   keep the API small and avoid generic over-design.
3. Replace false-positive-prone Terraform string extraction with anchored
   top-level resource assertions and focused negative tests.
4. Use regional-zone-count surge; add explicit singleton Gateway/delivery
   proactive replacement policies; model custom metric filter/scope and target
   kind independently; keep CPU configuration simple and scale-to-zero honest.
5. Give exact autoscaler-aware procedures for zero, stop-all replacement,
   rollback, Gateway/delivery replacement, and teardown. Document Artifact
   Registry reader access, COS startup/logging, `docker run --rm` repair, storage
   resolution, and simple delivery state loss.

The runtime/API addition promotes final verification to `pnpm verify:release`.
All four concerns receive one focused re-review after correction. The original
implementer is explicitly configured as `gpt-5.6-terra` / `medium`; runtime
metadata is recorded if exposed, otherwise configured profile and absence of a
visible mismatch remain the acceptance evidence.

## Correction Acceptance And Focused Re-review Dispatch

The pushed correction endpoint is `0f77f672`. It adds the public
`GceNodeDiscovery` lifecycle owner, application-supplied registry-storage
resolution in both packaged entrypoints, explicit Server resource ownership,
anchored Terraform policy extraction with false-positive regression coverage,
regional and singleton replacement policies, independently configurable custom
metric scope/filter/target kind, and the exact autoscaler-aware operational
procedures required by the accepted findings.

The original implementer reported 11 focused tests passing together with the
composite build typecheck, ESLint, TSDoc, strict snippet verification, Terraform
formatting and validation, Prettier, and diff checks. The worktree and pushed
branch are clean. The implementer was explicitly dispatched as the existing
implementer role with `gpt-5.6-terra` / `medium`. Runtime self-introspection was
unavailable; the immutable configured role/profile and absence of a visible
mismatch are the available acceptance evidence.

The focused re-review covers only substantively affected concerns:

- Style and maintainability: storage resolver seams, discovery-owner depth,
  anchored policy-test durability, naming, and package shape.
- Documentation: autoscaler-aware zero/replacement/rollback/teardown steps,
  custom metric wording, Artifact Registry access, COS startup/logging and
  repair behavior, storage resolution, and Gateway/delivery replacement.
- TypeScript/API: `GceNodeDiscovery` lifecycle/error/idempotence contract,
  application registry ownership and closure ordering, settings, examples, and
  exports.
- Performance and reliability: failure-safe resource closure, registry
  lifecycle, regional surge, custom metric scope/filter/target kind, singleton
  replacement policies, and exact autoscaler state transitions.

Style, TypeScript/API, and reliability reviewers are dispatched as their
existing roles with explicit `gpt-5.6-terra` / `high`. Documentation uses the
existing immutable documentation-reviewer profile `gpt-5.6-luna` / `medium`,
with `medium` explicit. Runtime metadata will be recorded if exposed;
otherwise, the immutable configured profiles and absence of a visible mismatch
remain the acceptance evidence under the protocol.

## Focused Re-review Results

- Style and maintainability: P2, address/backend/forwarding/autoscaler policy
  assertions still use raw text checks. P2, the custom resource extractor can
  be fooled by valid lowercase heredocs and block comments. All topology
  assertions need one durable top-level-resource scanner with negative
  fixtures.
- TypeScript/API: P2, `REFERENCE.md` does not document the exported
  `GceNodeDiscovery` ownership-transfer, stop-before-close, idempotence, and
  single/aggregate error contract. All runtime ownership, settings, examples,
  exports, and package-contract corrections are otherwise clean.
- Documentation: P1, Container-Optimized OS startup does not configure Docker
  credentials for private Artifact Registry images despite IAM and OAuth scope.
  P2, incompatible replacement and rollback lack a copyable check proving the
  application group reached zero before proceeding. The remaining operational
  guide is consistent.
- Performance and reliability: P1, `autoscaling_metric_scope` is not enforced
  against the Monitoring filter resource type, so a declared whole-group
  configuration can still select `gce_instance` data and fail to wake from
  zero. P2, rolling-update wording says one surge rather than one per selected
  zone. P2, simultaneous discovery-cancel and registry-close failure needs a
  regression test proving both errors are retained.

All reviewers reported their existing configured roles and the explicitly
dispatched profiles: Terra/high for style, TypeScript/API, and reliability;
the immutable Luna/medium documentation role. Runtime self-introspection was
unavailable in all lanes, with no visible mismatch.

## Final Correction Batch Dispatch

The original implementer receives the complete accepted batch as one pass:

1. Replace every topology raw-text assertion with one robust top-level HCL
   resource scanner, and cover line comments, block comments, uppercase and
   lowercase heredocs with negative fixtures.
2. Document the complete public `GceNodeDiscovery` lifecycle contract in
   `REFERENCE.md`.
3. Configure `docker-credential-gcr` for the exact Artifact Registry host in
   all COS startup scripts using a writable Docker configuration directory,
   and teach the required image-host/IAM/scope relationship.
4. Add a copyable, explicit zero-instance verification step before incompatible
   application replacement and rollback continue.
5. Make custom Monitoring metric scope operational by validating the filter's
   monitored resource type against the declared scope and scale-from-zero
   constraints; add invalid-combination tests.
6. Correct surge wording to one permitted surge per selected application zone,
   and add a dual lifecycle-failure test that verifies registry closure and the
   two retained `AggregateError` causes.

The existing implementer role remains configured as `gpt-5.6-terra` /
`medium`; runtime metadata is recorded if exposed, otherwise the immutable
configured profile and absence of a visible mismatch remain the acceptance
evidence. Covering tests and bounded deterministic checks must pass before one
last focused re-review of the affected concerns.
