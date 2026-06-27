# Spine TS Framework Specification

This folder defines the technical specification and autonomous build procedure for a TypeScript/Node.js framework inspired by Spine JVM.

The JVM research corpus lives in `../spine-jvm-docs`. This specification treats that corpus as the behavioral reference while making TypeScript-native design choices where Node.js, Protobuf-ES, decorators, process topology, and IPC require them.

## Documents

1. [TECHNICAL_SPEC.md](TECHNICAL_SPEC.md) - product-level architecture, non-negotiable constraints, runtime model, process topology, and module boundaries.
2. [PROTOBUF_CONTRACT.md](PROTOBUF_CONTRACT.md) - Protobuf compatibility rules, copied proto sources, Buf/Protobuf-ES generation, type URL registry, and generated/runtime metadata.
3. [RUNTIME_ARCHITECTURE.md](RUNTIME_ARCHITECTURE.md) - bounded contexts, buses, ZeroMQ-backed IPC abstraction, async signal processing, worker processes, read/write segregation, and storage boundaries.
4. [DEVELOPER_API.md](DEVELOPER_API.md) - OOP APIs, generic entity classes, decorators, repositories, command/event/query/subscription services, validation, and user-facing coding model.
5. [TODO_EXAMPLE_SPEC.md](TODO_EXAMPLE_SPEC.md) - required standalone to-do list server-side example application.
6. [BUILD_PROTOCOL.md](BUILD_PROTOCOL.md) - autonomous Codex-on-macOS development protocol, sub-agent orchestration, worktrees, reviews, logs, quality gates, and interruption recovery.
7. [CODE_QUALITY.md](CODE_QUALITY.md) - code quality, testing, documentation, TS documentation, security, performance, and tooling selection criteria used by all future coding/review agents.
8. [DECISION_LOG.md](DECISION_LOG.md) - initial decisions captured while preparing this specification. Future development must append to this file for every decision.

## Source Baseline

- Spine JVM reference: `../spine-jvm-docs`.
- Protobuf runtime: Buf `@bufbuild/protobuf` / `@bufbuild/protoc-gen-es` generated TypeScript.
- Validation runtime: `SpineEventEngine/validation-ts`, observed at `2.0.0-snapshot.4` in the cloned research source.
- Decorator baseline: TypeScript 5+ standard decorators. Legacy `experimentalDecorators` semantics and `emitDecoratorMetadata` must not be assumed unless explicitly isolated behind a compatibility adapter.
- Local IPC baseline: ZeroMQ over local IPC only, hidden behind framework transport abstractions.

