# T-0206 work log

## 2026-08-18 — Framing and code map

- Fresh baseline is integrated `origin/main` at `ec9a382b9`; the protected
  primary checkout was not used for implementation.
- Current `Server.start()` is caller-managed; `Server.run()` adds process
  signal ownership through the private `ProcessServerCoordinator`.
  `RunningServer` exposes only host, port, URL, and close.
- No managed multi-process application implementation exists. Existing real
  process fixtures in server and Delivery provide bounded readiness,
  termination, and orphan-cleanup patterns but are not product supervisors.
- The implementation belongs in `server`, not `deployment`: `server` already
  depends on `deployment`, so the inverse import would create a cycle.
- The existing `RetryableCloseGroup`, `RunningHttp2Server` close ordering, and
  process signal coordinator are reusable lifecycle patterns. Delivery's
  reconnect backoff is evidence for bounded timers but is not reused as child
  restart policy because the ownership and healthy-reset semantics differ.
- Current built-server state is intentionally private. The task may add one
  immutable internal assembly report for manifest derivation rather than
  reflection or a new public control API.
- No conceptual blocker was found. Product implementation remains pending
  until this framing checkpoint is pushed.
