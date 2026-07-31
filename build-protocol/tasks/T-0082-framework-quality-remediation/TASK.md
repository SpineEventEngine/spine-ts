# T-0082: Framework quality, validation, model, and documentation remediation

## Status

Accepted for integration.

## Classification

High-risk. This milestone changes serialized Protobuf packages and type URLs,
shared generation tooling, signal validation boundaries, every workspace
package version, example module topology, repository-wide documentation
enforcement, and public package guidance.

## Branch And Worktree

- Branch: `task/T-0082-framework-quality-remediation`
- Worktree: `.worktrees/T-0082-framework-quality-remediation`
- Baseline: `7407cc9d33f707bf01431426de09aa029ad44646`
- Started: 2026-07-30.

## Objective

Correct the authored-code and documentation standards exposed by the Chat
example, make framework validation and rejection generation remove end-user
boilerplate, migrate every workspace module to version
`2.0.0-snapshot.1`, normalize example Protobuf namespaces, simplify Chat to
one model module, and replace internal-history package prose with separate
human and agent documentation.

## Human-Imposed Requirements Ledger

1. TSDoc summaries must explain behavior or meaning. Vague verbs such as
   `Owns` and `Consists` are forbidden.
2. Handwritten TSDoc must never use a one-line form.
3. Every TSDoc block starts with a line containing only `/**`.
4. An empty line precedes every TSDoc block except at the beginning of a file;
   files must never begin with an empty line.
5. `@param` uses `@param name Description`, with no hyphen after the name.
6. The TSDoc block-format rules apply to all handwritten source, tests, and
   tooling. Documentation coverage remains required for public production and
   example APIs.
7. Signal validation is framework-owned and derives from Protobuf validation
   options supported by `@spine-event-engine/validation-ts`; examples must not
   handwrite equivalent validation boilerplate.
8. End users must not handwrite rejection throwable companions. Deterministic
   tooling generates them from top-level rejection messages and their Protobuf
   comments.
9. Authored example Protobuf fields and their documentation are separated by
   an empty line.
10. Protobuf message and field documentation uses the bounded context's
    language. It may begin with a noun when that is clearer and must avoid
    unrelated framework/CQRS terminology.
11. Merge Chat's `model` and `users-model` modules. Do not invent another
    example merely to demonstrate multi-model composition.
12. The root `package.json` is the source of truth for version
    `2.0.0-snapshot.1`, and every workspace module, including private examples,
    uses that version.
13. Spine-TS-owned Protobuf packages must not contain a `v1` component. Frozen
    third-party or copied upstream Protobuf packages are exempt.
14. Example Protobuf packages begin with `spine.examples.<domain>`.
15. Example type URL prefixes are `type.spine.examples.<domain>`.
16. Multiword example directories use one domain-defining word rather than
    underscores: Chat uses `chat`, project management uses `projects`,
    datastore orders uses `orders`, and Todo uses `todo`.
17. No user-facing documentation may contain internal execution-history terms
    such as wave, task ID, phase, slice, milestone, candidate, or promotion.
    Build-protocol task/work/review records remain internal and are exempt.
18. Every production package under `packages/*` has:
    - a beginner-oriented `README.md` that explains the module and teaches its
      public workflows with current examples in simple language; and
    - an agent-oriented `REFERENCE.md` containing the detailed technical
      contract.
19. Every package README links to its `REFERENCE.md` and explicitly identifies
    it as documentation for agents.
20. Review every user-facing Markdown document again, not only the files named
    by the human, and remove internal-history language and unsupported claims.
21. Do not alter frozen upstream Protobuf definitions.
22. Do not build Spine JVM.
23. Do not read, edit, stage, move, or delete either protected human-review
    file.
24. Use the autonomous build protocol, complete all required reviews,
    verification, commits, pushes, merge, post-merge verification, and remote
    synchronization before stopping.

## High-Risk Assumptions And Boundaries

- There are no external users or persisted compatibility obligations, so
  example type URL/package migrations need no compatibility bridge.
- Existing manually invented Chat byte-count limits are not retained unless
  they can be expressed by the accepted Protobuf validation options. The
  example must not preserve handwritten validation merely to retain invented
  limits.
- Framework signal validation must cover every normal command/event intake
  path that can invoke user code or persist a signal, without validating the
  same payload redundantly on one path.
- Generated Protobuf and handler output remains ignored and uncommitted.
- Production package boundaries and public exports remain minimal; the task
  must not add speculative APIs.

## Acceptance Criteria

1. Deterministic TSDoc enforcement rejects every forbidden form above and all
   handwritten repository TSDoc conforms.
2. Command and event payload validation is framework-owned, schema-based, and
   behavior-tested; Chat has no handwritten validation class or validation
   tests for duplicated rules.
3. Generic model generation emits typed rejection companions, including
   documentation derived from Protobuf comments; Chat has no handwritten
   `rejections.ts`.
4. Every authored example Proto file passes deterministic spacing,
   documentation, namespace, and type-prefix enforcement.
5. Chat contains one model module and every consumer/build/configuration path
   uses it.
6. Root and every workspace package version is exactly
   `2.0.0-snapshot.1`; one deterministic check proves the root is authoritative.
7. No Spine-TS-owned example Proto package or generated import path contains
   `v1`; frozen upstream files are unchanged.
8. Example packages/type URLs are exactly rooted at:
   `spine.examples.chat`, `spine.examples.projects`,
   `spine.examples.orders`, and `spine.examples.todo`.
9. Every production package has a current human README and agent REFERENCE,
   with the required link and audience statement.
10. User-facing documentation contains no internal execution-history wording,
    and all commands/snippets match current public APIs.
11. Focused tests, generated-clean checks, typechecking, linting, formatting,
    docs/API checks, full verification, and at least 90% branch coverage pass.
12. All relevant specialist review lanes converge, the task branch and `main`
    are pushed, post-merge verification passes, and the clean worktree is
    removed.

## Skill Applicability

- Sources checked: the session skill inventory, the full bounded
  `~/.agents/skills` entrypoint scan, `~/.agents/.skill-lock.json`, and
  `build-protocol/skills/EXPECTED_SKILLS.md`.
- Selected and fully read:
  - `using-git-worktrees`;
  - `implement`;
  - `subagent-driven-development`;
  - `requesting-code-review`;
  - `verification-before-completion`.
- Project protocol overrides the `implement` skill's instruction to commit
  before project review: commits occur only after the required review and
  verification gates, and every commit is pushed immediately.
- `doc-coauthoring` is not selected because the human supplied the rules and
  requested autonomous execution rather than an interactive writing session.
- Architecture/domain/backend skills are not selected as implementation
  authorities: the existing requirements splitter and project specifications
  govern this cross-cutting milestone.
- No new external library is planned. Existing `validation-ts`, Buf plugin
  tooling, TypeScript compiler APIs, and repository scripts are the required
  seams.

## Requirements Splitter Dispatch

- Existing role: `requirements_splitter`.
- Scope: dependency-ordered decomposition of this high-risk milestone into
  review-sized implementation tasks with one overlapping production writer at
  a time.
- Expected model: `gpt-5.6-sol`.
- Expected reasoning: high.
- Both fields must be explicit in dispatch.
- Runtime metadata or the immutable configured role/profile and its
  self-introspection limitation must be recorded before accepting the result.

## Requirements Splitter Acceptance

- Result: accepted on 2026-07-30.
- Plan: `build-protocol/planning/T-0082_EXECUTION_PLAN.md`.
- Configured role: `requirements_splitter`.
- Configured model: `gpt-5.6-sol`.
- Configured reasoning: high.
- Dispatch confirmation: model and reasoning were explicit.
- Runtime metadata: the execution surface did not expose separate runtime
  self-metadata. The immutable configured role/profile was confirmed, and this
  limitation does not require redispatch under the project protocol.
- Disposition: ten dependency-ordered slices cover every ledger item and
  preserve one overlapping production writer.

## Review Plan

- Style/maintainability: required for enforcement, generation, model topology,
  and repository-wide authored-code changes.
- Documentation: required for all READMEs, REFERENCE files, guides, examples,
  Proto prose, and TSDoc.
- TypeScript/API docs: required for TSDoc enforcement, public declarations,
  generated rejection companions, Protobuf contracts, and code snippets.
- Performance/reliability: required for signal-validation placement and any
  generator/runtime resource behavior.
- Final security review: required because the milestone changes validation
  boundaries and deserialization-to-handler admission.
