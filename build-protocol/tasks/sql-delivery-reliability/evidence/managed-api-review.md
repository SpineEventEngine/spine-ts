# Managed shutdown API review

Existing typescript_api_docs_reviewer, explicitly dispatched gpt-6-sol / medium,
Standard speed, read-only. Actual runtime metadata unavailable. Parent persists
the returned review because the reviewer did not edit files. No tests or builds.

## Configured parent budget does not reach a default-configured child

A parent configured with shutdownTimeoutMs:60_000 may legally fork a module that
calls ManagedServerApplication.run() with default options. Parent sends nearly
60,000ms remaining at managed-server-application.ts:2035. The child rejects a
remaining budget above its local30,000ms at line593, so it ignores the close
frame and the parent forces termination after the acknowledgement grace. Merely
removing the validation comparison is insufficient: child close() tightens the
deadline to its local default at line456. Make the managed parent's budget
authoritative while retaining the local budget for direct close/disconnection.

Regression: public parent start/run configured above30seconds, child module
using defaults, idle cohort closes promptly and successfully. Preserve strict
positive safe-integer/range validation and duplicate-frame nonextension.

## Narrow TSDoc completeness

Document the accepted1..2,147,483,647ms range in shutdownTimeoutMs TSDoc. Default,
retry semantics and cleanup grace are already documented. The exported declaration
contains the option; no accidental package export or Protobuf change was found.

This concern is collected with reliability, style and documentation before one
accepted correction batch.
