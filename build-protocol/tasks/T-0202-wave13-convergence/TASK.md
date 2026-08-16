# T-0202 — Wave 13 convergence and release closure

## Objective

Converge the completed JVM-aligned cross-context external-event subsystem:
publish documentation truth, complete one specialist/security review wave,
retain final same-process and native cross-process evidence, run one converged
release profile, integrate from isolation, push, and leave the remote with only
`main` and no tags.

## Baselines

- Spine TS baseline: `c9082938f12b33eb75eb666d935e13b164bd66fe`.
- Pinned Spine JVM source: `0779b5fa42ca5cebd0d2935fc3a3489ab47846dc`.
- T-0195 through T-0201 are integrated and post-merge verified.

## Ownership and execution

- Owner: primary orchestrator; this task introduces no new implementation
  identity.
- Documentation audit function: existing `documentation_reviewer`, explicitly
  configured `gpt-5.6-luna` / `medium`; no subagents; runtime telemetry
  unavailable.
- Documentation edits are serialized in this worktree. Specialist reviews are
  read-only and parallel only after deterministic convergence.
- The primary checkout and all protected human changes remain read-only.

## Acceptance

1. Public, package, architecture, developer, technical, and completion docs
   describe the implemented broker, schema universe, origin/tenant/loop rules,
   ThirdParty import, exact wire contracts, production configuration,
   transport delivery strength, and real cross-process usage without stale
   “future/not implemented” claims.
2. ContextTransport and SignalTransport remain explicitly distinct from the
   integration message-channel seam.
3. Same-process acceptance, native cross-process acceptance, and exact changed
   executable coverage remain green; live evidence is separate from V8
   coverage.
4. Applicable style/maintainability, performance/reliability, TypeScript/API,
   documentation, and final security reviews have durable dispositions.
5. Cheap preflight passes before one converged `pnpm verify:release`.
6. Isolated integration and post-merge checks pass; `main` is pushed; completed
   branches/tags are reconciled without discarding unique work; origin exposes
   exactly `main` and no tags.
