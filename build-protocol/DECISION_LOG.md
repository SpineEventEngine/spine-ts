# Decision Log

Navigation: [README](README.md)

Future implementation must append every decision here or to a task-specific decision file linked from here.

## D-0001: Documentation-only scope for current task

Answer from human: create documentation/specifications only now. Do not create package skeletons or implementation code.

## D-0002: New folder name

Answer from human: use `build-protocol` as the new root folder for this specification set.

## D-0003: Spine Protobuf files

Answer from human: required Spine Protobuf files must be copied into the TS framework implementation. The specification records this as a compatibility requirement; actual copying happens during implementation.

## D-0004: Compatibility target

Answer from human: no source-level compatibility with Spine JVM is required, but the TS framework should be conceptually familiar to Spine JVM users.

## D-0005: Handler declaration

Answer from human: use TypeScript decorators if they fit, and use the latest mature TypeScript decorator specification. The spec therefore targets TypeScript 5+ standard decorators and requires fallback/codegen investigation.

## D-0006: Custom code generation

Answer from human: whether custom code generation is required is an investigation decision. The spec defines the generated/runtime metadata contract but does not prescribe the generation mechanism.

## D-0007: ZeroMQ scope

Answer from human: ZeroMQ is only for local IPC signal transfer. Scaling beyond one host should use another transport behind the abstraction.

## D-0008: Bus topology

Answer from human: choose topology based on bus needs; buses have publishers and subscribers, and pub/sub appears natural. The spec uses pub/sub where appropriate but allows other ZeroMQ patterns inside the adapter for command/query semantics.

## D-0009: gRPC service contracts

Answer from human: keep Spine JVM gRPC interfaces, especially `CommandService`, `QueryService`, and `SubscriptionService`; sync/async behavior follows their definitions.

## D-0010: To-do example timing

Answer from human: the spec must require a standalone to-do example app, but details remain light until the framework shape is defined.

## D-0011: Build protocol execution environment

Answer from human: the build protocol will be executed in Codex on macOS with sub-agents available.

## D-0012: Human questions

Answer from human: stop on blocking questions. For non-blocking questions, spawn advisory sub-agents, have them propose/vote, record the result, and continue.

## D-0013: Tooling choices

Answer from human: define selection criteria now and defer exact choices.

## D-0014: Review coverage

Answer from human: every task, including documentation tasks, must receive code style, documentation, TS docs, security, and performance reviews.

## D-0015: Required docs from start

Answer from human: ADRs, package-level READMEs, and API references are required from the start; architecture diagrams are not required from the start.

## D-0016: Initialize implementation repository before first task branch

Date: 2026-06-27

Context: The implementation workspace initially contained the build protocol and JVM research documents but was not a Git repository. The build protocol requires one feature branch and one worktree per coding task/sub-task.

Decision: Initialize this workspace as a Git repository, commit the existing specification and bootstrap logs as the baseline, then create task-specific feature branches and worktrees from that baseline.

Alternatives considered:

- Treat the absence of Git as a blocking human question. Rejected because the user explicitly requested immediate autonomous progress and branch/worktree execution is part of the protocol.
- Use temporary directories without Git branches. Rejected because it would violate the protocol and make interruption recovery weaker.

Consequences:

- The initial repository history starts from the provided specification corpus plus the autonomous-process bootstrap logs.
- Task implementation branches are traceable from the first durable baseline commit.
