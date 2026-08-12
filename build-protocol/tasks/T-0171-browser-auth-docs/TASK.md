# T-0171: Browser, Authentication, And Message Board Journey

Status: Implementation authorized and starting

## Objective

Rewrite the browser/authentication/client and Message Board documentation into
one beginner-readable journey from a browser action to authenticated Commands,
queries, subscriptions, reconnection, and the supported single-Gateway shapes.

## Classification

High-risk documentation: public client/auth APIs, credentials, sessions,
subscriptions, browser limits, and runnable example behavior are described.

## Human-Imposed Requirements Ledger

- Scope is exactly the 20 T-0171 paths in the Wave 10 ownership table.
- Record `changed` or `reviewed-no-change` for every path; every TypeScript fence
  passes the strict shared checker and all local links resolve.
- READMEs stay concise and preserve look and feel; the browser guide teaches the
  workflow; REFERENCE files keep exhaustive contracts and limits.
- Prose is beginner-paced, natural, and structured; avoid needless “own” forms.
- Teach one path from browser UI through Node Gateway authentication to
  Command/query/subscription use and reconnect/re-query behavior.
- Never log or expose tokens, passwords, credentials, or authentication
  secrets. Stable non-secret identifiers may appear in operational examples.
- Describe only supported single-Gateway/fixed fan-in shapes. Multiple-Gateway
  behavior is deferred; Cloud Run is outside the initial offering.
- Do not duplicate canonical security/protocol material or add runtime behavior.
- T-0169 copyright and T-0170 strict snippet gates remain intact.

## Assignment

Single owner: existing `implementer`, explicit `gpt-5.6-terra` / medium. The
owner controls only the 20 T-0171 reader docs and T-0171 records, uses no
subagents, preserves unrelated work, and records runtime metadata if exposed.

## Verification And Review

Run strict snippets on all 20 paths, links, audience/API, auth-secret wording,
format/copyright/diff, and `verify:task -- --no-tests`. Review documentation,
TypeScript/API, and reliability; security facts are cross-checked against
canonical sources but no new security review is needed unless a boundary claim
changes. Style is N/A unless shared tooling changes.
