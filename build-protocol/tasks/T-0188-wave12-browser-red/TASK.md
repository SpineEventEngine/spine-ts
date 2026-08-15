# T-0188: Wave 12 Browser RED And Boundary Isolation

Status: COMPLETE

## Classification

High-risk diagnostic task. Baseline: `e2ab42d2` on
`codex/wave-12-browser`. This task owns only Message Board browser interop
entry/spec/harness/topology files and its durable records.

## Acceptance

- A passive Chromium viewer performs no writes while a separately authenticated
  writer sends three ordered messages through Chromium -> Envoy -> Gateway ->
  native gRPC.
- The viewer receives three ordered updates without test-forced reconnect.
- A direct-native three-update comparison records whether the backend stream
  remains healthy independently of Gateway/browser forwarding.
- After each update and after bounded shutdown, active stream, update, cancel,
  dispose, and binding counters are recorded; all owned resources close.
- Cookie/CSRF authorization, actor isolation, best-effort semantics, explicit
  overflow termination, and no-command-retry policy remain unchanged.

## Dispatch Record

Existing role: `implementer`; bounded function: T-0188 then only the
proven-owner T-0189 fix. Explicit configured profile: `gpt-5.6-terra`,
reasoning `medium`. Desktop runtime model/token/latency telemetry is
unavailable; immutable configured profile is the acceptance evidence. No
subagents are permitted. Other Wave writers use separate worktrees.

T-0188 closed by proving the Envoy renderer as the production owner. The
subsequent browser-harness correction belongs to T-0189.
