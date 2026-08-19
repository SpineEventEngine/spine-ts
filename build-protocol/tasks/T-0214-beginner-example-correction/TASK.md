# T-0214 — Beginner-ready To-Do and Message Board correction

**Status:** In progress

**Baseline:** `origin/main@8c878f0428d1b9ea959b47bf4b2155f4993a092d`

**Classification:** High-risk integration, split into one high-risk runtime lane,
one standard To-Do lane, and one high-risk live Message Board lane.

## Objective

Make every documented To-Do and Message Board startup mode understandable and
copy-paste runnable for a beginner, correct the proven sustained-subscription
defect, remove unrequested signing/session concepts from Message Board, and
prove the stock UI through every locally advertised route.

## Binding human decisions

- Process count and Delivery shard count are explicit independent deployer
  settings; neither is inferred from CPU count.
- Every managed child is a complete application replica.
- Multi-process and multi-node examples use actually shared storage; private
  per-process memory is not presented as shared.
- Message Board uses no browser session, credential, signing key, issuer,
  audience, or revocation concept. Its example Gateway trusts the incoming
  actor ID through existing configurable trust collaborators and reconstructs
  the server-owned context.
- One Message Board UI source/build serves every mode. Ordinary local modes do
  not use Envoy; every documented Envoy mode wires and proves the real UI.
- Kubernetes is a static cluster reference and is not launched locally.
- To-Do has purpose-named single- and multi-process source files plus commented
  launchers that own prerequisites and shutdown.
- General documentation says Event Store. `EntityEventStorage` remains only for
  the narrower entity diagnostic-history API.
- No unrelated quota, Gateway rollout, autoscaling, local Kubernetes, ZeroMQ,
  dependency, or broad security work enters this correction.

## Parallel ownership

- `codex/second-correction-framework`: `packages/auth` subscription lifecycle.
- `codex/second-correction-todo`: `examples/todo/**`.
- `codex/second-correction-message-board`: Message Board and Distributed Message
  Board example paths.
- `codex/second-correction-integration`: records, integration, reviews, final
  verification, and read-only remaining-example audit.

All implementers use the existing worker role with explicit
`gpt-5.6-terra` / `medium`; runtime self-introspection is unavailable, so the
immutable dispatch profile is the provenance. Subagents may not spawn subagents.

## Acceptance

- Sustained two-tab browser subscriptions survive the former finite-operation
  timeout and reconnect by querying current state before resuming updates.
- Message Board commands, queries, and subscriptions require no Authorization
  header and preserve the requested actor without trusting unrelated client
  context.
- All seven documented Message Board topology modes state exact ownership and
  every locally advertised path runs as written.
- To-Do single- and multi-process launchers run as written and clean up owned
  resources.
- Purpose names and file-level explanations cover every hand-written To-Do and
  Message Board TypeScript, JavaScript, and shell source.
- All Envoy modes use the stock UI and produce no 401 response.
- Configured replica counts match real child PIDs.
- The remaining-example audit is delivered without changing those examples.
- Focused gates, changed coverage, relevant review concerns, integrated live
  acceptance, and final release verification pass.

## Explicit non-goals

- No retained-subscription capacity policy.
- No Gateway deployment/redeployment policy.
- No autoscaler, KEDA, kind, or minikube work.
- No framework SignedSessions removal.
- No rewrite of Orders, Projects, GCE, or GKE before separate approval.

