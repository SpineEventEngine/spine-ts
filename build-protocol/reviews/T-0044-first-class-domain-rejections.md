# T-0044 Review Log

Status: Slice 1 review pending - pre-review lint clean

Baseline: `1aa345ae`

Branch: `task/T-0044-first-class-domain-rejections`

## Review Contract

Review first-class domain rejection behavior against the human requirements,
current active T-0044 records, and verified Spine JVM mechanics. Historical or
superseded text is not actionable unless a current task record or changed
current document claims it as active behavior.

Prioritize concrete defects in Proto compatibility, generated throwable
typing, handler metadata, transaction rollback, event construction, event
publication, acknowledgement timing, public API honesty, and consumer-facing
examples. Do not preserve `CommandRefusalError` merely because it is current.

## Canonical Dispositions

- Style/maintainability: relevant for every executable slice.
- Documentation completeness: relevant for public behavior and final closure;
  a purely internal preparatory slice may justify N/A only if no current docs
  can be affected.
- TypeScript/API docs: relevant for generated/public contracts and every slice
  that changes exports, declarations, handler typing, or TypeDoc.
- Performance/reliability: relevant for transaction, event publication,
  asynchronous acknowledgement, persistence, or dispatch changes.
- Security: final focused integration review is required because serialized
  rejection payloads and stack/error disclosure cross a client-visible
  boundary. It is not added as a routine reviewer to every child slice.

Reviewer assignments, immutable endpoints, packages, explicit/actual model
metadata, results, fixes, and closure evidence remain pending.

## Slice 1 Pre-Review Lint

- Status records agree that T-0044 is active at Slice 1 and project readiness
  remains reopened. The former pending-architecture status in this review log
  was corrected before reviewer dispatch.
- The module-private rejection-construction token is the single nominal
  construction policy. Generator names, suffix policy, dependency version, and
  staged-output paths have no conflicting duplicate constants in the slice.
- `RejectionThrowable` and `createRejectionThrowable` are intentional public
  core contracts required by generated consumer code and are present in the
  TypeDoc export inventory. The construction token and instantiator remain
  private.
- The changed core README limits its claim to validated throwable generation
  and explicitly says event publication is future server-runtime work; it does
  not overclaim Slice 2 behavior.
- `git diff --check`, focused tests, typechecks, docs checks, Proto lint,
  formatting, and generated-output cleanliness passed before review.

## Slice 1 Review Dispositions

- Style/maintainability: relevant; core public abstraction and generator code.
- Documentation completeness: relevant; public core README behavior changed.
- TypeScript/API docs: relevant; two public core exports and generated typing.
- Performance/reliability: relevant; validation, deep freezing, generator
  atomicity, and recursive message handling.
- Security: N/A for this slice under the protocol's final-only security lane;
  no event/client disclosure exists yet. Final T-0044 security review remains
  mandatory.
