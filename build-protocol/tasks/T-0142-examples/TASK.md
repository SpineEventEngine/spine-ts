# T-0142: Wave 8 Example Migration

Status: Complete on stacked integration train; integration pending.

## Objective

Move every example to the settled Wave 8 storage, delivery, authentication, and
validation APIs, deleting invented persistence and retired compatibility usage
without substitutes.

## Classification

Standard. Changes span several example applications and tests, but use frozen
framework contracts and introduce no new subsystem or architecture.

## Acceptance

- Orders and Message Board use `DatastoreStorageFactory.newBuilder()` with a
  caller-owned Datastore client; removed static factory options/creation are
  absent.
- Message Board contains no delivery quarantine, removal fingerprint,
  revoked-session storage/facility, subscription dispose hook, or replacement
  record/state.
- Remote delivery and browser server configuration use only current public
  options.
- Retired RecordSpec `schema` usage is removed from example persistence owned
  by this slice.
- Static scans reject old layouts, quarantine, fingerprints, revocation
  facilities, and removed APIs.
- All example builds and focused behavior/startup tests pass; coverage-enabled
  `verify:task` plus the all-example suite is recorded after review convergence.

## Implementation Assignment

- Existing role: project `implementer`.
- Explicit dispatch profile: `gpt-5.6-terra` / `medium`.
- Sole production writer owns `examples/**` source/tests/manifests and T-0142
  task/work records.
- Do not change framework production APIs, introduce compatibility aliases,
  invent replacement persistence, edit the T-0142 review record, or spawn
  subagents.

## Review

- Documentation, TypeScript/API documentation, and style/maintainability are
  required.
- Performance/reliability applies only where runtime topology or lifecycle
  behavior changes.
- Security is N/A unless example authentication changes the trust boundary;
  deletion of an unsupported revocation facility must be documented truthfully
  but does not authorize a replacement.
