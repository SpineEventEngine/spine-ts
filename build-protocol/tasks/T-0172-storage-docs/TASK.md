# T-0172: Persistence, Queries, And Data Examples

Status: Implementation authorized and starting

## Objective

Rewrite storage, MySQL, Datastore, Orders, and Projects documentation into a
beginner journey from Proto `(column)` declarations to persisted records and
typed Query pushdown.

## Classification

High-risk documentation: serialized layouts, identifiers/stringifiers,
provider-native tenancy, query symmetry, transactions, migration, and limits.

## Human-Imposed Requirements Ledger

- Scope is exactly the 10 T-0172 paths in the Wave 10 ownership table.
- Record `changed` or `reviewed-no-change` for every path; every TypeScript fence
  passes the strict checker and all local links resolve.
- READMEs stay concise/preserve look and feel; references hold dense layouts,
  limits, migration, and provider contracts.
- Prose is beginner-paced, natural, and structured; avoid needless “own” forms.
- Teach `(column)` mapping and write/query symmetry through Identifiers,
  Stringifiers, registries, and actual supported scalar/message types.
- MySQL stores ID, bytes, framework Entity attributes where applicable, and
  only declared Proto columns; unmarked fields remain only in bytes.
- Datastore uses native tenant namespaces, kind/key/bytes/declared properties;
  MySQL uses configured tenant databases. Bounded Context names never partition
  physical data. No `_scope` or `_revision` invention may return.
- Explain legal Query pushdown, typed values, pagination, migration/fail-closed
  schema checks, and test setup without inventing interoperability claims.
- T-0169 copyright and T-0170 strict snippet gates remain intact.

## Assignment

Single owner: existing `implementer`, explicit `gpt-5.6-terra` / medium. The
owner controls only the 10 T-0172 reader docs and records, uses no subagents,
and preserves unrelated work.

## Verification And Review

Run strict snippets on all 10 paths, links, schema/layout/tenancy claim matrix,
audience/API, format/copyright/diff, and `verify:task -- --no-tests`. Review
documentation, TypeScript/API, and performance/reliability. Style/security are
N/A absent tooling or security-boundary changes.
