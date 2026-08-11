# T-0158: Command Routing

Status: Complete

## Objective

Add the public `CommandRouting<Id>` contract and integrate it into repository
construction, command admission, dispatch, and replay. Preserve Spine's exact,
descriptor-semantic, and declaration-first default precedence without invoking
application routing again during replay.

## Classification

High-risk. This task adds a public generic API and changes Entity selection for
accepted Commands across Aggregate and Process Manager execution paths.

## Baseline And Isolation

- Baseline: `origin/main@e3bd0dfa`.
- Branch: `task/T-0158-command-routing`.
- Worktree: `.worktrees/T-0158-command-routing`.
- Preserve the dirty primary checkout and unrelated worktrees.
- Push only to `origin`; never push the upstream remote.

## Acceptance Criteria

1. Export the frozen Wave 9 public `CommandRoute<Id, Schema>` and
   `CommandRouting<Id>` API exactly, including `create()`, exact `route()`,
   descriptor-backed `routeSemantic()`, and `replaceDefault()`.
2. Add `commandRouting` to `RepositoryOptions` using the repository's inferred
   Entity ID type. Repository construction snapshots configuration so later
   builder mutation cannot change a built repository.
3. Resolve routes in exact message > descriptor `(is)` > descriptor
   `(every_is)` > default order. Caller compatibility `semanticTags` never
   participate.
4. Reject duplicate exact routes, duplicate semantic routes, incomplete or
   malformed registrations, and multiple applicable routes within the selected
   semantic tier at repository construction.
5. The default route reads the first field in descriptor declaration order and
   requires it to be singular, non-map, ID-compatible, present, valid, and
   non-default. Redundant explicit `(required)` remains allowed.
6. Custom/default-replacement results use the existing repository ID validation
   and reject malformed, missing, or incompatible IDs before handler execution
   or Inbox admission.
7. Evaluate application routing exactly once for an accepted Command. Durable
   replay validates and uses the target stored in the Inbox row and never calls
   application routing code again.
8. Cover Aggregate and Process Manager behavior, generated registry metadata,
   public typing, construction snapshots, precedence, ambiguity, defaults,
   invalid results, and restart/replay behavior with focused RED/GREEN tests.
9. Reach at least 90% in every changed-production-source metric and run relevant
   builds/typechecks, changed TypeScript ESLint, TSDoc/API checks, Prettier,
   `git diff --check`, and prohibited compatibility scans.
10. Complete one style/maintainability, TypeScript/API documentation,
    documentation/TSDoc, and performance/reliability review wave. Security is
    N/A because no trust boundary changes.
11. Run one final `verify:task`, merge to `origin/main`, and delete the merged
    task branch/worktrees.

## Exclusions

- Event and state-update routing, `@Where`, Stringifier field mappings,
  implicit-required validation, rejection conformance, examples, product
  Markdown, and copyright headers.
- Compatibility aliases or routing from caller `semanticTags`.

## Implementation Assignment

- Existing role: implementer acting as a senior TypeScript routing/runtime
  engineer.
- Ownership: the new Command routing module, Command members of
  `RepositoryOptions`, construction/dispatch/replay integration, exports,
  focused tests, and T-0158 records.
- Expected model: `gpt-5.6-terra`.
- Expected reasoning: `medium`.
- Both dispatch fields are explicit. The implementer must not spawn subagents.

## Review And Verification

- Style/maintainability: required; configured `gpt-5.6-terra` / high.
- TypeScript/API documentation: required; configured `gpt-5.6-terra` / high.
- Documentation/TSDoc: required; configured documentation reviewer
  `gpt-5.6-luna` / medium.
- Performance/reliability: required; configured `gpt-5.6-terra` / high.
- Security: N/A; no authentication, authorization, secret, or trust-boundary
  behavior changes.
