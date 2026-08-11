# T-0156A: Auth, Remote Delivery, And Deployment Containment Logging

Status: Complete; integrated and post-merge verified

## Objective

Add the selected operational WARN, ERROR, and no-log dispositions for auth,
remote delivery, listener, and deployment lifecycle boundaries. Use the direct
`ILogLayer` options established by T-0154; do not add a facade, callback API,
global logger, or fallback logger.

## Classification

High-risk. This task changes asynchronous containment around authentication,
remote delivery, network listeners, discovery, renewal, and deployment cleanup.

## Human-Imposed Requirements Ledger

- Framework and application code use LogLayer directly through the existing
  application-supplied options.
- Emit each failure exactly once at the outer containment or termination
  boundary; inner observers must not duplicate the record.
- WARN means contained degraded, retryable, or best-effort work continues.
  ERROR means accepted work is permanently lost or a terminal background
  component stops.
- Cancellation, normal close, validation, surfaced/rethrown failure, expected
  remote outcomes, and bookkeeping resets emit no record.
- Stable tenant, actor, Entity, command, event, shard, and subscription IDs may
  be logged when bounded. Payloads, exception details, headers, tokens,
  passwords, cookies, signing keys, session material, and other authentication
  secrets may not be logged.
- Logger throws and promise-like rejections must not change business outcomes
  or create unhandled rejections.
- The application retains logger lifecycle responsibility; framework
  components must not close or reconfigure supplied loggers.
- Product Markdown, README, and USER_GUIDE changes remain deferred to Wave 10.

## Baseline And Isolation

- Baseline: `origin/main@22f53284`.
- Branch: `task/T-0156A-remote-boundary-logging`.
- Worktree: `.worktrees/T-0156A-remote-boundary-logging`.
- Preserve the dirty primary checkout and unrelated worktrees.
- Push only to `origin`; never push the upstream remote.

## Acceptance Criteria

1. Inventory actual containment boundaries in `packages/auth`,
   `packages/delivery-client`, `packages/delivery-server`,
   `packages/deployment`, `packages/deployment-gce`, and
   `packages/deployment-gke`; bind each selected or explicit no-log suppression
   to one adjacent stable ID and containment-manifest entry.
2. Emit one WARN for active discovery or renewal failure when the component
   contains the failure and continues or retries.
3. Emit one ERROR for a reproduced terminal server-listener or equivalent
   background component failure that is not otherwise surfaced. Do not invent
   an ERROR boundary when ownership already surfaces the failure.
4. Preserve no-log behavior for cancellation, normal close, expected remote
   delivery results, surfaced/rethrown errors, and control-flow observers.
5. Propagate only the existing direct application logger options into private
   package helpers. Add no public option, facade, callback, global, or fallback.
6. Prove auth-secret negative behavior and bounded allowlisted fields for every
   new auth or remote boundary.
7. Prove application logger lifecycle remains external and throwing/rejecting
   transports do not alter component outcomes.
8. Begin every production behavior with focused RED evidence and reach at
   least 90% in every changed-production-source metric.
9. Run focused tests, generated/package typechecks, changed TypeScript ESLint,
   TSDoc, Prettier, containment checking, secret scans, and `git diff --check`.
10. Complete one style/maintainability and performance/reliability review wave;
    TypeScript/API documentation and product documentation are N/A unless a
    public contract changes. Security review remains assigned to T-0167.
11. Run one final `verify:task` after review convergence, record exact evidence,
    merge to `origin/main`, and delete the merged task branch/worktrees.

## Exclusions

- T-0155 and T-0156 server bus, repository, service, Stand, subscription,
  delivery-supervisor, and environment lifecycle partitions.
- Public logging API design and LogLayer dependency composition from T-0154.
- Routing, semantic metadata, `@Where`, implicit IDs, rejections, examples,
  product documentation, and copyright headers.

## Implementation Assignment

- Existing role: implementer acting as a senior TypeScript runtime engineer.
- Ownership: the six named package sources, their focused tests, their
  containment-manifest partition, and T-0156A records.
- Expected model: `gpt-5.6-terra`.
- Expected reasoning: `medium`.
- Both dispatch fields must be explicit. The implementer must not spawn
  subagents or modify excluded product documentation.

## Review And Verification

- Style/maintainability: required; configured `gpt-5.6-terra` / high.
- Performance/reliability: required; configured `gpt-5.6-terra` / high.
- TypeScript/API documentation: N/A unless the frozen public contract changes.
- Documentation: N/A; product Markdown is Wave 10 scope.
- Security: deferred to T-0167; deterministic secret-negative tests are
  mandatory here.
