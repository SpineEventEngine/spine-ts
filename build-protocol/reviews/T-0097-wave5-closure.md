# T-0097 Wave 5 Closure Review

Status: Specialist concerns converged; final security review pending
Baseline: `0f47c634`
Candidate: `543917c4`

## Requirements And Evidence

- Task ledger: `build-protocol/tasks/T-0097-wave5-closure/TASK.md`.
- Accepted split: `build-protocol/planning/WAVE_5_EXECUTION_SPLIT.md`, G1.
- Evidence log: `build-protocol/work-logs/T-0097.md`.
- Mechanical preflight passes through the complete `verify:task -- --no-tests`
  profile after dependency alignment.
- Final native acceptance passes pinned Envoy validation 1/1 for four configs,
  topology/policy 8/8, local-image contracts 8/8, and real Compose lifecycle
  3/3 with leak-free cleanup.

## Assignments

Every assignment uses an existing role, receives the full task ledger, and has
explicit configured metadata recorded before dispatch. Runtime self-
introspection is unavailable; no result is accepted after omitted fields,
visible mismatch, or inherited fallback.

- Style/maintainability: `style_maintainability_reviewer`, explicit
  `gpt-5.6-terra` / high.
- Documentation: `documentation_reviewer`, immutable
  `gpt-5.6-luna` / medium.
- TypeScript/API: `typescript_api_docs_reviewer`, explicit
  `gpt-5.6-terra` / high.
- Performance/reliability: `performance_reliability_reviewer`, explicit
  `gpt-5.6-terra` / high.
- Final security: `security_reviewer`, explicit `gpt-5.6-terra` / high; starts
  only after specialist convergence.

## Dispositions

- Style/maintainability: clean; no P0-P3 findings.
- Documentation: clean; no P0-P3 findings.
- TypeScript/API: accepted one P2 wording correction. Shared signing and the
  registry namespace belong to browser-capable combined/gateway processes, not
  application-only replicas; registry and revocation are distinct logical
  records over the same application-selected storage.
- Performance/reliability: accepted two P1 Envoy findings. Every RPC route must
  require `:method = POST`; CORS preflight policy alone does not restrict direct
  requests. Activate's disabled route timeout must be paired with explicit
  `stream_idle_timeout: 0s` to make the documented quiet-stream policy true.
- Final security: pending.

No P0 or P3 finding was reported. Assign the complete two-P1/one-P2 batch to the
existing implementation context. Corrections must update all four Envoy copies,
the structural policy tests, a data-plane non-POST rejection, the quiet-stream
policy evidence, and the narrow storage/session wording. Re-review only API and
reliability after focused verification.

## Correction Evidence

- Commit `17eece42` requires exact path plus `POST` matching for every browser
  RPC route, disables the HTTP connection manager idle timeout for quiet
  subscription streams, adds a GET rejection regression, and corrects the
  gateway/session storage wording.
- The Compose/Kubernetes policy and topology suite passes 8/8.
- Pinned real-image Envoy validation passes 1/1 for all four configurations.
- The three-case Compose lifecycle suite passes with leak-free cleanup.
- Formatting and `git diff --check` pass.
- Only the TypeScript/API and performance/reliability concerns are reopened.

## Affected Re-review

- Performance/reliability: clean; no P0-P3 findings. All four Envoy
  configurations enforce the exact six POST-only routes, Activate retains an
  unlimited route timeout, every HTTP connection manager has an unlimited
  stream idle timeout, and the structural plus data-plane evidence passes.
- TypeScript/API documentation: one remaining P2 wording inconsistency was
  accepted. The container and application READMEs still described revocations
  as living under the shared registry namespace instead of as distinct
  application-owned logical records.
- Both assignments explicitly used their recorded existing roles with
  `gpt-5.6-terra` / high. Runtime self-introspection was unavailable, and no
  visible role or profile mismatch occurred.
- The two README descriptions now distinguish application-owned revocations
  from the gateway-owned subscription registry and identify the configuration
  that browser-capable replicas must share. Formatting, generated-document,
  audience, and diff checks pass. Only this wording receives final API
  confirmation.
- Final TypeScript/API confirmation: clean; no P0-P3 findings. Both corrected
  guides accurately state the browser-capable process scope and the distinct
  registry-versus-revocation ownership model.
