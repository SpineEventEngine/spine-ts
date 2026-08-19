# T-0213 execution plan

## 1. Read-only inventories

Run four bounded inventories before assigning a writer:

1. current security surfaces, trust boundaries, controls, and regressions;
2. dependency/install-script/signature exposure and approved build policy;
3. current stale documentation/status/release records;
4. exact retained native, package, Todo, Docker, and Compose release smokes.

Three run concurrently; the fourth starts in the next available slot. Every
assignment uses an existing function with explicit model/reasoning and no
subagents.

## 2. Release-plumbing correction

One implementation owner removes deleted test invocations and obsolete Todo
dependency/guidance, strengthens metadata and T-0212 removal guards, refreshes
the lockfile, and proves the corrected release command contains one global
coverage run with no special-case deleted fixture.

## 3. Security artifacts and dependency evidence

One artifact owner replaces the stale threat model with the current topology,
adds the T-0213 security findings/audit record, and marks the prior T-0041
findings historical. The model covers Gateway, Coordinator, complete replicas,
shared storage/Delivery, process-local IntegrationBroker, tenant boundaries,
generated modules, diagnostics, dependencies, and build/release tooling. The
deleted ZeroMQ residual is retired rather than carried forward.

## 4. Dedicated final security gate

After artifacts and audits are committed, run the existing final
`security_reviewer` over the whole current release. Return one complete finding
batch grouped by trust boundary. Stop for the human only if a concrete residual
risk cannot be removed within accepted contracts.

## 5. Release/status/documentation convergence

Reconcile the completion plan, capability matrix, task-status mirrors,
supported example/release commands, and explicit first-release exclusions.
Historical chronology remains truthful; current guidance must not require
deleted ZeroMQ/local-multiprocess behavior.

## 6. Pre-review evidence and real smokes

Run generated/tooling/policy/docs gates, serialized managed-process acceptance,
Todo standalone smoke, Message Board image contract, one-node Compose, and
distributed Compose. Generated metadata churn is restored unless caused by an
intentional source change.

## 7. Specialist release review

Run style/maintainability, TypeScript/API, performance/reliability, and
documentation completeness over the final release package. Collect one wave,
return one correction batch, and re-review only affected concerns. Reopen
security only for security-boundary changes.

## 8. Full release gate

Run `pnpm --config.verify-deps-before-run=false verify:release`, explicit
release-readiness, generated-file, diff, status, package import, documentation,
coverage, dependency, managed-process, and real-smoke checks. Record exact test
and coverage counts; global branches must be at least 90%.

## 9. Integration and cleanup

Push every checkpoint, merge into isolated `main`, run the full post-main gate
and retained real smokes, push `main`, delete the task branch, remove only clean
merged worktrees, preserve dirty/unmerged user or planning worktrees, and
confirm the remote has exactly `main` and no tags.
