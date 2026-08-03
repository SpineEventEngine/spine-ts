# T-0096 Compose and Kubernetes Review

Status: Final correction in progress
Baseline: `0e06800b`
Candidate: `f089d075`

## Requirements And Evidence

- Human-imposed requirements and acceptance criteria:
  `build-protocol/tasks/T-0096-compose-kubernetes/TASK.md`.
- Accepted Wave 5 split:
  `build-protocol/planning/WAVE_5_EXECUTION_SPLIT.md`.
- Implementation and verification evidence:
  `build-protocol/work-logs/T-0096.md`.
- The corrected real Compose lifecycle passes 3/3 tests in 55.2 seconds and
  removes all resources. Topology and Kubernetes policy tests pass 5/5, both
  Compose files render, and the local image contract passes 7/7 tests.
- `verify:task -- --no-tests` passes the full deterministic TypeScript,
  lint/TSDoc, formatting, API documentation, Proto, generated-cleanliness,
  package, asset, and Markdown-link preflight.

## Reviewer Assignments

Every assignment uses an existing role and must inspect the full human-imposed
requirements ledger. Model and reasoning are explicit dispatch fields.
Runtime self-introspection is unavailable on this surface; the immutable
configured role/profile and absence of a visible mismatch are recorded as the
acceptance evidence. An omitted field, visible mismatch, or inherited fallback
requires redispatch.

- Style/maintainability: existing `style_maintainability_reviewer`, expected
  `gpt-5.6-terra` / high.
- TypeScript/API documentation: existing `typescript_api_docs_reviewer`,
  expected `gpt-5.6-terra` / high.
- Performance/reliability: existing `performance_reliability_reviewer`,
  expected `gpt-5.6-terra` / high.
- Documentation completeness: existing `documentation_reviewer`, expected
  immutable `gpt-5.6-luna` / medium profile.

Final security remains the Wave 5 release-readiness gate in T-0097.

## Concern Dispositions

- Style/maintainability: accepted two P1 findings for unrestricted Kubernetes
  routing and over-broad cancellation-error suppression, plus one P2 finding
  for three duplicate declarations of the environment delivery-port contract.
- Documentation completeness: accepted P1 findings for missing runnable Compose
  and Kubernetes guidance, plus P2 findings for an incomplete production
  reference and local-only defaults described without a clear scope.
- TypeScript/API documentation: accepted P1 findings for ambiguous legacy target
  ID detection and unnormalized malformed StringValue payloads, plus one P2
  finding for missing semantic documentation of the environment-owned ports.
- Performance/reliability: accepted five P1 findings. Kubernetes installed an
  unrestricted route and an ordinary ClusterIP that bypassed Envoy's hash ring;
  application replica 2 lacked the delivery health dependency; remote workers
  reused a context name instead of the process node ID; and deployment-level
  missing-registry fail-closed acceptance was absent.

No reviewer reported a P0 or P3 finding. The overlapping Kubernetes routing
finding is one correction. Every accepted P1 and P2 is assigned together to one
implementation owner; affected concern re-review is required after focused
verification.

## Correction Evidence

- `bc833b07` replaces unrestricted Kubernetes routing with the explicit RPC
  allowlist, finite unary timeouts, Activate-only streaming timeout, and
  replica-aware headless gateway discovery.
- `e34b6484` completes the accepted runtime, acceptance, ownership, error,
  TSDoc, and beginner-documentation corrections.
- Focused runtime tests pass 99/99; topology/manifest tests pass 5/5. Real
  Compose lifecycle and image-level fail-closed acceptance pass with bounded
  resource cleanup. Prettier and `git diff --check` are clean.
- All four concerns changed substantively and therefore receive one targeted
  re-review. The original explicit model/reasoning assignments remain binding.

## Affected-Concern Re-review

- TypeScript/API documentation is clean. Explicit StringValue encoding,
  protocol-error normalization, and the relevant documented contracts are
  accepted.
- Style/maintainability retains two P2 findings: one canonical delivery-port
  type is not yet used at all three sites, and the manifest policy test must
  parse and assert the exact route/timeout allowlist rather than reject one
  textual catch-all spelling.
- Performance/reliability retains one P1 and two P2 findings: public Envoy
  references need restricted CORS preflight support; manifest tests must bind
  replicas and delivery waits to both standalone Deployments; and the
  missing-registry image test must forcibly remove its named container on a
  timeout. The CORS correction applies to both equivalent Compose and
  Kubernetes public Envoy references.
- Documentation retains three P1 and two P2 findings: exact clean-checkout
  Compose commands and key creation; Kubernetes image/Secret prerequisites;
  mandatory shared signed-session configuration; durable registry/fencing and
  reconnect/re-query limits; and explicit shared application-selected storage.
- Mechanical preflight also found one optional-field narrowing error in the new
  codec regression test. It is included in the same final correction batch.

No P0 or P3 remains. The final batch contains four P1, six P2, and one
mechanical TypeScript correction. Re-review after correction is limited to the
substantively changed style, reliability, and documentation concerns; the clean
API concern reopens only if its contract changes.

## Final Targeted Findings

- Performance/reliability is clean. The corrected CORS/preflight, exact RPC
  routes, Deployment-specific readiness, and forced timeout cleanup are
  accepted.
- Style/maintainability accepts the canonical port contract but retains one P2:
  the policy test must structurally parse every Envoy route and reject any
  non-approved match, rather than combine regex extraction with one literal
  catch-all spelling.
- Documentation retains two P1 findings: remove the contradictory instruction
  to publish local images, and provide concrete storage/runtime/TLS Secret and
  local-image prerequisites so the reference can be applied without hidden
  inputs. Operator image distribution remains explicitly out of scope.
- The embedded placeholder runtime Secret cannot overwrite the documented
  operator-created Secret. Remove that placeholder resource while retaining the
  external Secret reference in both manifests.

After this bounded batch, re-review only the structural policy assertion and
the two documentation findings. Do not start another complete review wave.
