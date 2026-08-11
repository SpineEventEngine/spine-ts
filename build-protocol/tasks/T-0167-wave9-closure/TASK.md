# T-0167: Wave 9 Closure

Status: Reviews complete; final release verification pending

## Objective

Audit the integrated Wave 9 train, complete the cross-wave concern and security
reviews, run one converged release verifier, and durably close Wave 9 without
adding production behavior.

## Classification

High-risk release boundary. This task changes no runtime contract, but it must
validate the integrated logging secret boundary, routing and generated-metadata
contracts, package/API shape, examples, and repository-wide release state.

## Baseline and isolation

- Baseline: `origin/main@7c4e72fa`.
- Branch: `task/T-0167-wave9-closure`.
- Worktree: `.worktrees/T-0167-wave9-closure`.
- The dirty primary checkout and both human-review files remain untouched.
- Push only to `origin`; do not push upstream or publish packages.

## Human-imposed requirements ledger

1. Use LogLayer directly; do not invent a Spine logging facade, global logger,
   or framework logger lifecycle.
2. Applications create, retain, flush, and close their logger. Framework parts
   receive children without reconfiguration or lifecycle ownership.
3. Keep logging collector-neutral while proving structured default output and
   direct official Google Cloud Logging composition. Sentry is not Wave 9 work.
4. Emit operational WARN/ERROR once at the containing boundary. Logger failure
   must not alter business behavior.
5. Stable tenant, actor, Entity, command, event, shard, worker, node, and
   subscription IDs may be logged. Tokens, passwords, cookies, authorization
   headers, signing/session/CSRF/OIDC secrets, and other auth secrets may not.
6. Wave 9 logging is server-side; browser logging is excluded.
7. Commands, Events, and Entity state updates support JVM-familiar custom,
   replacement-default, exact, `(is)`, and `(every_is)` routing as applicable.
8. Event and state-update routes may select no target; Commands remain unicast.
9. A valid compatible Event producer ID routes directly. A valid incompatible
   producer falls back to the declaration-first Event field. A malformed
   compatible producer fails.
10. Exact routes precede message `(is)`, then file `(every_is)`; ambiguity fails
    at construction.
11. `@Where` uses exact `eventField` and `equals` options; invalid declarations
    fail.
12. `@Where` supports nested Event paths and field Stringifiers for
    `@Subscribe`, `@React`, and Event-input `@Command`, not command assignments,
    command-input reactions, or Entity-state subscriptions.
13. Declaration-first Command and Entity-state fields are implicitly required
    when no explicit option exists; redundant explicit required is valid.
14. Rejection, command, and event Proto filenames follow the approved single-
    file and multi-file package convention.
15. Preserve the existing generated rejection throwable, rollback, rejection
    Event, and client outcome; do not add another rejection mechanism.
16. Message Board demonstrates the natural Wave 9 end-user features.
17. Public API TSDoc ships now; root/package READMEs, `docs/USER_GUIDE.md`, and
    other product/example Markdown remain Wave 10 work.
18. Copyright correction and multiple-Gateway behavior remain Wave 10; Cloud
    Run remains outside the initial offering.
19. Do not build or modify Spine JVM.
20. Push only to `origin`; never push upstream without a new explicit human
    instruction, and do not publish to npm.
21. Preserve user-owned dirty files and use canonical build-protocol records,
    not scratch ledgers.
22. Continue autonomously and stop only for a real external/product blocker.

## Acceptance criteria

1. Confirm every T-0154 through T-0166 feature and correction is represented on
   `origin/main` and reconcile stale task statuses.
2. Run deterministic API/export, secret-field, containment-manifest,
   generated-clean, Proto, package/import, copyright-deferral, and
   product-Markdown-deferral audits.
3. Complete one cross-wave style, TypeScript/API, documentation/TSDoc, and
   performance/reliability review plus the final security review.
4. Make no new production implementation in this task. Any substantive defect
   returns to the affected contract and receives focused evidence before the
   release profile.
5. Run the mandatory cheap preflight, then exactly one converged
   `pnpm verify:release`.
6. Integrate by fast-forward to `origin/main`, run post-merge proof, push the
   Wave 9 tag if the repository's tag policy defines one, and remove the merged
   task branch/worktree locally and remotely.
7. Record Wave 9 complete and leave the approved preliminary Wave 10 guide
   structure for renewed human discussion under T-0168.

## Assignment and review profiles

The active system policy prohibits subagent dispatch, overriding the normal
project delegation flow. The primary orchestrator performs the record-only
closure and concern-specific reviews using the configured profiles as the
standard: style, TypeScript/API, reliability, and security use
`gpt-5.6-terra` / high; documentation uses `gpt-5.6-luna` / medium. Runtime
model metadata is unavailable. No production implementation owner is assigned
unless an audit finds a substantive defect.
