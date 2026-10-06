# Spine Time implementation plan

Baseline: official origin/master 52fb932f25ab1dc1b8617169d9502bccebcef21e.
Architecture pass: requirements_splitter, explicitly gpt-6-astra/high, read-only,
no child delegation. Configured profile confirmed; separate runtime metadata not
exposed. No human decisions required. Follow D-0124 and spine-time-task.md.

## Shared contract

One browser-safe packages/core/src/time.ts implementation, core/time subpath,
re-export same module from core barrel. No generated schema dependency in leaf.
Time.currentTime returns configured-provider canonical Timestamp; systemTime
uses shared system provider; currentTimeZone returns IANA string;
currentTimeMillis returns integer epoch milliseconds; monotonicTime returns
monotonic elapsed milliseconds from local origin. JVM-style provider interface
currentTime plus optional currentZone/monotonicTime fallback to system.
setProvider returns previous provider for try/finally restoration; resetProvider
restores default. Provider controls are documented internal testing surfaces.
System clock offsets increment 1000 nanos, reset on underlying millisecond
change and wrap after1000 calls per reference. Scope is module/JS realm, not a
distributed uniqueness claim. Test Timestamp bounds and normalized negative epochs.

Node24 prebuild scripts import the same erasable TypeScript leaf; compiled
framework execution uses compiled entry. Do not mix provider-mutating source
and dist instances in one graph. Keep sequential provider mutation within
isolated test files; no AsyncLocalStorage clock subsystem.

Preserve legacy Clock.now(): Date inputs using adapters. SignalMetadata accepts
TimeProvider too; default timestamp creation returns full Time timestamp without
Date conversion. Explicit supplied Date conversion remains supported. SystemClock
can delegate both precise currentTime and legacy now to Time.

SQL columns already epoch nanos: preserve them. Test Datastore SDK precise
encoding and use full protobuf payload for occurrence decoding. Inbox whenReceived
and pagination anchors must carry Timestamp; normalize supplied legacy Date at
input boundaries. Lease/expiry fields may retain documented millisecond contracts.
No new wire fields/database schema, Time wrapper Date, counters or Agent code.

## Sequential slices under one implementation context

A. Time leaf, exports and TDD contract tests, browser/bootstrap proof.
B. Runtime occurrence creation and compatible clock adapters.
C. Precise inbox receipt, pagination and transport/store tests.
D. Every remaining time read in packages, scripts, tests, examples; AST bypass gate.
E. Focused preflight, concern-specific review, correction batch, one converged
release verification plus provider precision evidence, version-only commit,
immediate feature-branch pushes. No PR creation or merge.

Only the implementer writes production files. Orchestrator maintains task logs,
executes independent read-only checks and coordinates reviews. Do not rebuild or
clean outputs concurrently with implementer tests.
