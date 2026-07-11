# Round 118 Fix Report

## Scope

- Add `DeliveryEndpointMessage` to the curated API README durable-delivery
  export inventory.
- Document the public `InboxReadOptions.limit` cap in `DEVELOPER_API.md`.
- Keep raw `Delivery`, `DeliveryLoop`, `OnDeliveryMessage`, and direct-drain
  APIs outside the stable root-public application API.

## Verification

- `pnpm --config.verify-deps-before-run=false docs:check` passed.
- `pnpm --config.verify-deps-before-run=false format:check` passed.
- `git diff --check` passed.

Coordinator commit is pending.
