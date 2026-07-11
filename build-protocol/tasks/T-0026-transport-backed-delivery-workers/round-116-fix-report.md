# Round 116 Fix Report

## Scope

- Export `DeliveryEndpointMessage` from the `@spine-ts/server` package root
  without exposing raw direct delivery APIs.
- Add `DeliveryEndpointMessage` to the API docs root-export expectation.
- Update curated API docs so `DeliveryEndpointMessage` is root-public while
  `Delivery`, `DeliveryLoop`, `OnDeliveryMessage`, direct `onMessage` examples,
  and direct-drain option/result types remain outside the stable app API.
- Mark the old Round 7 `CATCH_UP` fail-close fix sentence as historical and
  superseded by current pending-skip semantics.

## Verification

- `pnpm --config.verify-deps-before-run=false docs:check` passed. TypeDoc
  reported the known invalid `origin` source-link warning only, and
  `scripts/check-api-docs.mjs` reported 204 expected `@spine-ts/server`
  exports.
- `pnpm --config.verify-deps-before-run=false typecheck:build:generated`
  passed (`tsc -b`).
- `pnpm --config.verify-deps-before-run=false format:check` passed after
  targeted markdown formatting.
- `git diff --check` passed.

Coordinator commit is pending.
