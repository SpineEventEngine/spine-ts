# Code Quality and Tooling Rules

Navigation: [README](README.md) | Related: [Build Protocol](BUILD_PROTOCOL.md)

This document defines the standards that future implementation and review sub-agents must apply. It intentionally specifies criteria first; exact tooling choices are made during implementation after current library investigation.

## Tool Selection Criteria

Before choosing a library or dev dependency, the implementing sub-agent must:

- check current stable releases;
- check maintenance activity, issue health, security posture, and TypeScript support;
- prefer well-known, actively maintained libraries;
- prefer libraries with first-class ESM and Node LTS support;
- avoid bespoke implementation of common infrastructure until a library search is documented;
- record the decision and alternatives in [DECISION_LOG.md](DECISION_LOG.md).

Candidate areas to investigate:

- package manager and workspace tooling;
- TypeScript compiler version and module target;
- linting and formatting;
- test runner and coverage;
- mutation/property testing where useful;
- gRPC server/client library;
- ZeroMQ Node binding;
- structured logging;
- OpenTelemetry;
- TypeDoc/API docs;
- release/versioning tooling.

## TypeScript Standards

Implementation must use current TypeScript best practices:

- strict type checking;
- no implicit `any`;
- explicit public API types;
- ESM-first package design unless a documented compatibility reason says otherwise;
- typed errors or structured result types for framework-level outcomes;
- no global mutable state except isolated registries with deterministic lifecycle;
- async APIs return `Promise` or async iterables;
- public APIs documented with TypeDoc comments;
- generic base classes and interfaces where they improve type safety.

## Testing and Coverage

Coverage target is at least 90%.

Coverage must include:

- unit tests for metadata, validation, routing, buses, storage, and decorators;
- integration tests for bounded context command/event/query/subscription flows;
- multi-process transport tests for the ZeroMQ adapter;
- black-box tests for the to-do example;
- regression tests for every bug fix;
- compatibility tests for copied Spine Protobuf message shapes and type URLs.

Coverage exceptions require a documented decision and reviewer approval.

## Documentation Requirements

Every task must update documentation:

- architecture documentation when behavior or boundaries change;
- package README when public package behavior changes;
- TypeDoc comments for public APIs;
- user guide sections when end-user workflows change;
- ADR/decision log entries for architectural or tooling choices.

Both the framework and the to-do example must have separate `USER_GUIDE.md` files before they are considered usable.

## Review Standards

Every task, including documentation-only tasks, must be reviewed by these reviewer roles:

- code style/maintainability reviewer;
- documentation reviewer;
- TypeScript/API docs reviewer;
- security reviewer;
- performance/reliability reviewer.

Reviewers must produce actionable comments. The authoring sub-agent must address them or record an explicit accepted exception. Review repeats until no comments remain.

## Security Standards

Security review must check:

- unsafe deserialization or `Any` unpacking;
- validation bypasses;
- tenant isolation;
- command/query authorization extension points;
- local IPC trust boundaries;
- dependency vulnerabilities;
- logging of sensitive data;
- denial-of-service risks in regex validation, subscription fan-out, and broker queues.

## Performance Standards

Performance review must check:

- unnecessary serialization/deserialization;
- event fan-out cost;
- query index usage;
- broker backpressure;
- memory retention in subscriptions and registries;
- worker process startup and shutdown behavior;
- hot-path reflection or metadata lookup caching.

## Non-Duplication Rule

Code style and quality rules must be assembled into a single authoritative file during implementation. Sub-agents must not create overlapping rule files that duplicate or conflict with each other. This document is the seed for that later authoritative file.

