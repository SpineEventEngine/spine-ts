# T-0165: Rejection conformance

Status: Complete; integrated and post-merge verified

## Objective

Prove that the existing typed domain-rejection mechanism remains singular,
rollback-safe, client-visible, and restricted to the approved Proto filename
conventions.

## Classification

High-risk. The task verifies code generation, trusted throwable construction,
handler classification, Entity rollback, Event publication, and client-visible
outcomes. Production changes are permitted only for defects established by a
RED test or source checker.

## Baseline and isolation

- Baseline: `origin/main@81ca2834`.
- Branch: `task/T-0165-rejection-conformance`.
- Worktree: `.worktrees/T-0165-rejection-conformance`.
- Preserve the dirty primary checkout and publish only to `origin`.

## Acceptance criteria

1. Accept exactly `rejections.proto` and `*_rejections.proto` basenames for
   top-level domain rejection messages.
2. Reject misleading suffixes such as `notrejections.proto`, nested rejection
   messages, and non-rejection files consistently in generation, runtime
   construction, analyzer classification, and generated-registry ingestion.
3. Keep one mechanism: generated throwable companions, Entity rollback, one
   typed rejection Event with the original rejected-Command context, and the
   existing client outcome.
4. Prove a rejected command commits neither state/history nor normal Events and
   does not dispatch the rejection through a duplicate mechanism.
5. Add a deterministic source checker for authored rejection filename
   conventions and wire it into the existing Proto workflow.
6. Cover both accepted filename forms and representative rejected forms.

## Assignment

- Frozen plan: existing requirements splitter, explicit `gpt-5.6-sol` / high.
- Implementation: primary orchestrator acting as the bounded implementation
  owner under the existing implementer function, `gpt-5.6-terra` / medium; no
  implementation subagents.
- Runtime model metadata is unavailable; configured profiles are the durable
  assignment evidence.

## Review and verification

Style, TypeScript/API, documentation/TSDoc, and performance/reliability concerns
are required. Security is N/A for this conformance-only slice; final Wave 9
security review remains mandatory under T-0167.
