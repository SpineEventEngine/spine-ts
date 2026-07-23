# T-0067: Wave 1 Documentation And Closure

Status: complete; integrated and post-merge verified.

Baseline: `893d8756`

## Objective

Close JVM parity Wave 1 with accurate end-user and package documentation,
compilable public snippets, a current upstream-delta audit, one final
repository-wide security review, full verification, integration, and remote
synchronization.

## Classification

High-risk because this packet is the release-wide acceptance boundary for new
public APIs, a trusted-network gRPC topology, resource ownership, and the
declared Wave 2/3/4 handoff. Documentation changes themselves must not invent
new runtime contracts.

## Human-Imposed Requirements Ledger

- Complete Wave 1 autonomously and report feature-level progress; internal task
  identifiers must not replace descriptions of what is done and what remains.
- Use the streamlined selective-review protocol and continue unless a genuine
  protocol or environmental blocker is documented.
- Review the end-user guide and every inline snippet against the latest
  codebase; snippets must be present, current, and mechanically validated.
- Include comprehensive, example-backed documentation for all approved Wave 1
  features and limitations without over-engineering or blindly copying JVM
  implementation details.
- Node.js is the only supported environment in Wave 1.
- Delivery server scope is only the in-memory `simple-server`; exclude Redis,
  Hazelcast, every other upstream delivery-server module, and human admin UI or
  TUI work.
- Live TS/JVM compatibility is deferred to Wave 3. Recent state/event history
  and high-level Aggregate/Process Manager queries are deferred to Wave 2.
- Push the task branch and `main` to `origin` immediately after every commit.
- Preserve all unrelated files and never read, modify, stage, commit, delete,
  move, or use `human-review-1-jul.md` as project input.

## Acceptance Criteria

- Document the Node client, environment configuration, `BlackBox`, Delivery
  topology, standalone in-memory delivery server configuration/lifecycle/trust
  boundary, `update()` / `tryUpdate()`, Projection columns and Query DSL, and
  runnable examples.
- Use current package-root public imports and inline TypeScript snippets that
  compile or are mechanically checked against the latest codebase.
- State all limits precisely: Node only; Projection-only high-level queries in
  Wave 1; in-memory simple delivery server; trusted-network use; no Redis,
  Hazelcast, durable delivery-server persistence, live TS/JVM compatibility,
  deployment packaging, or human admin UI/TUI in this wave.
- Compare current `core-java` and `delivery-server` upstream heads with frozen
  commits `a408b0d70dafd603efc55b89c8b4b6f3e8c19d3b` and
  `21f2901f393e552208b97166f4eaeb942f9f5172`. Classify every relevant delta as
  adopt now, defer to its approved wave, or out of scope. Any adopted runtime
  semantic change becomes a separately owned correction.
- Run documentation and TypeScript/API review and the existing final security
  reviewer. Record concrete N/A reasons for style/reliability unless content or
  adopted deltas substantively affect those concerns.
- Run the full repository verification gate, merge into `main`, post-merge
  verify, and push the task branch and `main` after every commit.

## Ownership And Safety

- One implementer owns all task-branch writes. Read-only audits and specialist
  reviews may run independently.
- Preserve unrelated files and the generated-script mode change produced by
  dependency setup unless a separately reviewed task owns it.
- Do not expand into Wave 2 recent history/Aggregate and Process Manager query
  parity, Wave 3 packaging/live JVM compatibility, or Wave 4 administration.

## Dispatch Gate

- Implementer: existing `implementer` role, expected and explicitly dispatched
  `gpt-5.6-terra` / `medium`.
- Documentation reviewer: existing immutable role
  `documentation_reviewer`, `gpt-5.6-luna` / `medium`.
- TypeScript/API reviewer: existing `typescript_api_docs_reviewer`, expected
  and explicitly dispatched `gpt-5.6-terra` / `high`.
- Final security reviewer: existing `security_reviewer`, expected and
  explicitly dispatched `gpt-5.6-terra` / `high`.
- Runtime metadata is recorded when exposed. If self-introspection is
  unavailable, record the immutable configured role/profile and limitation;
  redispatch only for an omitted field, wrong role, visible mismatch, or actual
  inherited fallback.
