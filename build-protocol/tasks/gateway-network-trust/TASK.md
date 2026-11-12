# Gateway network trust

Status: implemented, independently reviewed, and locally release-verified on
`gateway-network-trust`. GitHub CI awaits a human-created PR.
Baseline: official `origin/master` at `3844fd369`.

## Human-Imposed Requirements Ledger

- Add explicit `forwarding: "trusted-network"` to browser Gateway and managed
  outgoing configuration. Add the same choice to the native adapter's options.
- Add `readerAdmission: "trusted-network"` to native Server and managed listener
  configuration. Accept valid unsigned reader metadata or an identity-free call.
- Keep existing defaults and proof-based configuration. Missing configuration
  must not enable unsigned authenticated forwarding or discard a principal.
- Reject contradictory configuration, malformed reader metadata, and
  proof-bearing metadata on a trusted-network-only listener. Never turn malformed
  identity into anonymous admission.
- Preserve Gateway authentication, authorization, Actor/tenant resolution,
  reader facts, read filters, subscription identity checks, and cancellation.
  Admission without a principal does not grant service or administrator rights.
- Cover Post, Read, Execute, Subscribe, Activate, Cancel, compensation, and both
  managed forwarding hops. Each connection selects its trust policy explicitly.
- Network reachability is the deployment's trust boundary in the new mode. Do
  not infer trust from loopback, a header name, or an omitted proof.
- Do not change Google login, sessions, gRPC service definitions, storage,
  Entity-family behavior, or introduce migrations or artificial limits.
- Document configuration for each process and both trust choices. Use current
  public imports and the existing auth/server package boundaries.
- Keep the work in this separate branch/worktree, push every semantic commit,
  and leave PR creation and GitHub PR/Issue edits to the human.

## Approach

Authentication and public configuration make this a high-risk bounded change.
Reuse the existing reader envelope, separating structural validation from proof
creation/verification. Add one explicit alternative rather than a new strategy
hierarchy. Keep the signed path's request binding and the unsigned path's
structural operation checks distinct in code and documentation.

The approved architecture review covers this contract. Current Spine JVM
`QueryService` and `SubscriptionService` sources at `a108f30a896` were inspected:
their service entrypoints route domain requests through delegates and do not
introduce the TypeScript reader-proof protocol. No Entity-type distinction is
introduced by this task.

## Acceptance

Use behavior tests for the mode matrix, malformed metadata, identity-free
internal calls, unchanged signed verification, principal/fact preservation,
subscription identity and lifecycle, real Gateway-to-server transport, and
managed forwarding. Run focused coverage and deterministic preflight before
independent API, reliability, maintainability, and documentation review.
Run `verify:release` after convergence because native admission and forwarding
are shared runtime. Prepare and trial the final release archives locally.
Exact-commit GitHub CI follows a human-created PR.

## Remaining work

A human creates the PR, then GitHub CI verifies its final commit. Local package
archive preparation and trial use the final branch commit before handoff.

## Review outcome

Independent API, reliability, maintainability, and documentation review findings
are addressed. The corrections isolate public admission options from internal
trust flags, verify reader identity through subscription cleanup, avoid unused
request serialization, and explain configuration separately for each process.
Targeted re-review and regression checks confirmed the corrections.

## Local verification

The release profile passed with 7,202 Vitest tests and 44 Node tests. Branch
coverage is 90.10%; all coverage thresholds passed. Workspace and web builds,
tooling, lint, documentation snippets, and generated-output checks passed.
No new dependency was added. Both dependency-audit scopes reported no known
vulnerabilities. Detailed execution evidence remains outside Git.
