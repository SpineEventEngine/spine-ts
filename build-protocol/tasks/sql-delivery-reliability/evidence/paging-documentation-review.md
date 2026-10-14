# Exact remote paging documentation review

Existing documentation reviewer, explicit gpt-6-luna / medium. Original dispatch
specified both fields; follow-up retained profile. Runtime introspection unavailable.
No edits, tests or builds. Parent persisted the chat result.

## Findings

- P2: delivery-client/REFERENCE.md around line 40 must state sinceWhen and after
  are mutually exclusive. sinceWhen is an exclusive initial timestamp filter,
  not a continuation fallback. Client rejects the combination locally; server
  rejects INVALID_ARGUMENT.
- P3: the same reference around line 68 must state the caller signal cancels
  the whole RemoteInbox multi-page collection, including later page requests.

Required endpoint, manual router registration, standalone exposure, exact tuple
order and deleted cursor behavior, live-read limits and no legacy fallback or
stronger JVM parity claims were documented. The known stale DeliveryPagingError
description was not duplicated.
