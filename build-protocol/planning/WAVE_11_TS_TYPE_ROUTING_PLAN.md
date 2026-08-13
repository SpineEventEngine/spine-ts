# Wave 11: TypeScript Semantic Interfaces And Routing

Status: Requirements splitting in progress

## Purpose

Wave 11 will adopt the fresh upstream `ts_type` contract for `(is)` and
`(every_is)`, generate and verify TypeScript semantic interfaces, expose
same-named runtime routing tokens, restore interface-based routing through the
existing `.route(...)` interface, and demonstrate the complete behavior in the
To-Do application.

The canonical human requirements are in
[`T-0178`](../tasks/T-0178-wave11-plan/TASK.md). This document will become the
dependency-ordered executable plan after repository, upstream, and Spine JVM
analysis plus specialist review.

## Explicit Deferral

Multiple-Gateway behavior is deferred to Wave 12. Wave 11 does not change its
runtime, deployment, or documentation contracts.
