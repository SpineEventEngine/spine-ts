# T-0075 Slice F implementation report

## Scope and outcome

Slice F closes the Wave 4 public documentation surface without changing runtime
behavior. It adds the authoritative
`docs/BROWSER_CLIENT_AUTH_EXTENSION_GUIDE.md`, links it from every required
user, API, package, Chat, and Envoy surface, and reconciles the stale auth
README statement that OIDC/provider and browser reconnect integration remained
a later Wave 4 slice.

The guide records the package ownership map, public auth/client extension
contracts, configuration and failure tables, cookie/bearer and opaque/signed
decisions, generic OIDC/Google/GitHub/custom-provider flow, identity/tenant
mapping pseudocode, request-kind authorization matrix, multi-node
session/revocation guidance, redaction rules, Mermaid diagrams, Envoy topology,
testing matrix, and the complete mandatory Wave 4 limitation inventory.

`docs/check-typescript-snippets.mjs` now treats the guide as a public snippet
surface and fails closed when its required limitation wording or required
discoverability links disappear.

## Runtime/profile record

- Existing role/function: implementer.
- Expected model and reasoning were explicitly dispatched as `gpt-5.6-terra` /
  `medium`.
- Runtime self-introspection metadata is not exposed to this agent. The
  immutable configured implementer profile is the available actual-profile
  evidence; no visible fallback or role mismatch occurred.
- No child agents, commit, push, merge, Spine JVM build, JVM test, JVM
  generation, JVM launch, JVM download, or JVM dependency resolution occurred.

## Focused evidence

All commands ran in the T-0075 worktree on 2026-07-29:

| Check                                                                                                   | Result                                                                           |
| ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `node docs/check-typescript-snippets.mjs`                                                               | Passed; public TypeScript snippets and guide limitation/link inventory accepted. |
| `pnpm --config.verify-deps-before-run=false docs:check:generated`                                       | Passed; TypeDoc generated and API inventory accepted.                            |
| `pnpm --config.verify-deps-before-run=false format:check`                                               | Passed.                                                                          |
| `pnpm --config.verify-deps-before-run=false --filter @spine-event-engine/client-web check:dependencies` | Passed.                                                                          |
| `pnpm --config.verify-deps-before-run=false exec eslint docs/check-typescript-snippets.mjs`             | Passed.                                                                          |
| `git diff --check`                                                                                      | Passed.                                                                          |

## Known limits

The guide intentionally preserves the approved limits: no npm publication, no
runtime or complete-transitive JVM compatibility claim, no browser delivery
completeness claim, no cross-node propagation before Wave 6, no application
deployment enforcement, and no provider/session/policy implementation supplied
by the framework itself.

## Handoff

The Slice F documentation candidate is ready for the required four specialist
review lanes and final security review. The coordinator retains ownership of
the Wave 4 task/review/work logs, commit, push, merge, and post-merge gates.

## Consolidated review correction batch

The single consolidated Slice F review batch was applied without runtime or
public-contract redesign:

- The primary cookie `Client.forGrpcWeb()` snippet now passes the exact
  `credentials: session.credentials` transport setting. The documentation
  checker fails if that invariant is removed.
- Public TypeScript fences in the authoritative guide now compile against real
  exported package declarations, including `@spine-event-engine/auth`; they do
  not receive generated `any` import stubs. The one application-only identity
  example is explicitly a `text` pseudocode fence.
- The gateway table now calls the first column “Required gate” and states that
  ResolveContext performs valid-session validation without invoking the
  authorization policy. The existing F brief was already consistent: it says
  only that subsequent requests are authenticated and authorized independently.
- The guide now has a compact exact-signature section for authentication,
  session resolution, identity mapping, context resolution, authorization,
  provider exchange, session issuance, revocation, request facts, native
  forwarding, and trusted subscription binding ownership. The checker requires
  that section and its discoverability anchors.
- Source-verified finite Envoy, relay, unary/subscription request, backend
  envelope, binding, operation, and shutdown limits are in a dedicated table.

The correction verification passed on 2026-07-29:

| Check                                                                                                   | Result                                                                                          |
| ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `node docs/check-typescript-snippets.mjs`                                                               | Passed; authoritative guide fences resolve real exports and required guardrails remain present. |
| `pnpm --config.verify-deps-before-run=false docs:check:generated`                                       | Passed.                                                                                         |
| `pnpm --config.verify-deps-before-run=false format:check`                                               | Passed.                                                                                         |
| `pnpm --config.verify-deps-before-run=false exec eslint docs/check-typescript-snippets.mjs`             | Passed.                                                                                         |
| `pnpm --config.verify-deps-before-run=false --filter @spine-event-engine/client-web check:dependencies` | Passed.                                                                                         |
| `git diff --check`                                                                                      | Passed.                                                                                         |

## Residual documentation correction

The final narrow batch adds declaration-checked routes for all remaining native
request-boundary seams: `typeof transportFacts`,
`NativeGatewayRequestContext["credential"]`, and
`NativeGatewayRequestContext["transport"]`. The documentation checker requires
those exact routes so a later removal or rename fails validation.

The verified limits table now records `pendingOperationLimit: 1` precisely: a
binding permits one active operation plus one queued operation; a third rejects
as `binding-busy`. This wording is also fail-closed in the checker. No runtime
behavior, task brief wording, public declaration, or package metadata changed.

Residual-batch verification passed on 2026-07-29: `node
docs/check-typescript-snippets.mjs`, `pnpm --config.verify-deps-before-run=false
docs:check:generated`, `pnpm --config.verify-deps-before-run=false
format:check`, `pnpm --config.verify-deps-before-run=false exec eslint
docs/check-typescript-snippets.mjs`, and `git diff --check`.
