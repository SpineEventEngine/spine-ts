# T-0100: DDD and CQRS README vocabulary

Status: Complete
Start: `2026-08-03`
Baseline: `d4c3915a`
Branch: `task/T-0100-cqrs-ddd-readmes`
Worktree: `.worktrees/T-0100-cqrs-ddd-readmes`

Classification: Standard documentation task. The change spans the repository's
human-facing entry points but does not alter runtime, public TypeScript,
Protobuf, package, dependency, or deployment contracts.

## Objective

Makes Spine TS README files describe the framework through Domain-Driven
Design and CQRS: Bounded Contexts, Commands, Events, Aggregates, Process
Managers, Projections, write-side decisions, and read-side views. Removes
generic “message-driven” positioning where it obscures those concepts while
preserving each README's current visual structure and beginner-friendly style.

## Human requirements

1. README introductions and feature explanations must speak about DDD and CQRS,
   including Commands and Events, instead of positioning Spine as generic
   message processing or “message-driven” infrastructure.
2. The existing Spine TS README look and feel—titles, emoji section headings,
   short paragraphs, check-mark lists, examples, warnings, and audience split—
   must remain recognizable.
3. Legitimate domain vocabulary remains legitimate. MessageBoard messages,
   Protobuf message types, validation messages, transport messages, and exact
   code/API terms must not be mechanically renamed.
4. Every repository README must receive an explicit reviewed/changed or
   reviewed/no-change disposition. Maintainer-only protocol, fixture,
   compatibility, generated-source, and deployment instructions must not gain
   forced DDD prose that misstates their purpose.
5. All commands, snippets, links, package names, and current behavior claims
   must remain accurate.
6. The coordination checkout's existing root `README.md` edit and protected
   human-review files must remain untouched.
7. Review, verify, commit, push, merge, post-merge verify, and push `main` under
   the build protocol.

## Vocabulary reference

The official Spine site describes Spine as applying DDD with less boilerplate,
using Protobuf to define Commands, Events, and entity state, routing a Command
to one Aggregate, feeding Events to Projections, and separating write-side and
read-side work with CQRS. This task uses that conceptual vocabulary without
copying JVM-specific APIs or website prose.

## Assignment

- Implementation owner: existing `implementer`, sole README/task-record writer.
  Expected explicit model `gpt-5.6-terra`, reasoning `medium`.
- Documentation reviewer: existing role with immutable configured
  `gpt-5.6-luna`, reasoning `medium`.
- TypeScript/API, style/maintainability, and performance/reliability concerns
  receive concrete N/A dispositions unless the implementation changes code,
  commands, snippets, or behavioral/API claims that activate them.
- Reader testing uses a fresh read-only documentation-reviewer instance after
  documentation review, as required by the selected documentation workflow.
  The general-agent surface rejected Luna; the existing immutable role retained
  the required `gpt-5.6-luna` / `medium` profile without inherited fallback.

## Acceptance criteria

1. Root, package, and example READMEs consistently introduce Spine as a
   DDD/CQRS framework rather than generic message-driven infrastructure.
2. Commands express requested business actions; Events express domain facts;
   Aggregates protect write-side consistency; Projections provide query-side
   views; Process Managers coordinate longer business flows where applicable.
3. No text falsely claims that every package or fixture directly implements
   all DDD/CQRS concepts.
4. Existing README structure and visual style remain intact.
5. Deterministic README/link/audience/prohibited-wording checks and focused
   reader testing pass.
6. The reviewed task is merged, post-merge verified, and pushed.

## Completion

Merged into `main` as `f15da527`. The merged tree passed
`pnpm verify:task --no-tests` and was pushed to `origin/main`.
