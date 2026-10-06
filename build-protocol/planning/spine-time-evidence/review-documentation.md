## Required fixes

- **Low —** [packages/client-web/src/client/client.ts](/Users/armiol/.codex/worktrees/spine-time/spine-ts/packages/client-web/src/client/client.ts:1566): `RequiredSubscriptionRuntimeOptions` is an interface describing required runtime settings, but its TSDoc says it “Returns” a result. Describe the settings it contains instead.

- **Low —** [packages/testing/src/black-box/black-box.ts](/Users/armiol/.codex/worktrees/spine-time/spine-ts/packages/testing/src/black-box/black-box.ts:1136): `NormalizedBlackBoxOptions` is likewise an options shape, not a returned result. Its summary should identify the normalized tenant, zone, timeout, and interval settings.

- **Low —** [packages/delivery-client/src/client/types.ts](/Users/armiol/.codex/worktrees/spine-time/spine-ts/packages/delivery-client/src/client/types.ts:323): `sinceWhen` now accepts either `Date` or Protobuf `Timestamp`, but its documentation does not explain the compatibility boundary. State that legacy `Date` anchors retain millisecond precision while `Timestamp` anchors preserve submillisecond precision.

I found no confirmed inaccuracies in the changed README claims about synchronous calls, time units, provider replacement/restoration, module-local scope, or the client-node example. Inbox TSDoc also documents the `Date | Timestamp` input and full-precision storage reads.

**Review limitation:** I used the recorded mechanical evidence and inspected relevant source and TSDoc; I did not rerun tests or broad checks.
