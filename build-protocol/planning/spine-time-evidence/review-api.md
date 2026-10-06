**Required fixes**

- **P1 — Declare the delivery client’s new runtime dependency.** [remote/adapters.ts](/Users/armiol/.codex/worktrees/spine-time/spine-ts/packages/delivery-client/src/remote/adapters.ts:15) imports `@spine-event-engine/core/time`, but [package.json](/Users/armiol/.codex/worktrees/spine-time/spine-ts/packages/delivery-client/package.json:35) lists core only under `devDependencies`. A production install that does not hoist the server’s transitive copy of core can fail to load the delivery client. Move core to `dependencies` and update the lockfile.

- **P2 — Give precise Inbox read results a precise output type.** [inbox.ts](/Users/armiol/.codex/worktrees/spine-time/spine-ts/packages/server/src/delivery/inbox.ts:307) says storage reads return a full precision `Timestamp`, but `InboxMessage.whenReceived` remains `Date | Timestamp`. Thus TypeScript callers of `Inbox.read()`, `readMessage()`, and delivery-client reads cannot use `seconds` or `nanos` without narrowing a `Date` that these implementations do not return. Separate the normalized read result from legacy `Date | Timestamp` write inputs, while retaining Date input compatibility.

I used the recorded mechanical and provider evidence and inspected focused tests; I did not rerun broad checks. This review covers the assigned TypeScript/API contracts, not the remaining specialist concerns.
