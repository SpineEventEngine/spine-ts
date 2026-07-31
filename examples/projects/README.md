# Projects — Project management in Spine TS

This example creates projects through a real local Spine server and follows the
result through a query and a Projection subscription.

## 💡 What will you learn?

- ✅ How a larger bounded context registers Aggregates, Process Managers, and
  Projections.
- ✅ How generated handlers connect commands and events to domain code.
- ✅ How a Node client posts `CreateProject`, queries `ProjectSummary`, and
  observes an update.
- ✅ How to run a bounded, repeatable local load scenario.

## 🚀 Run it

Install workspace dependencies once:

```bash
pnpm install --frozen-lockfile
```

Then run ten independent users:

```bash
SPINE_PROJECT_LOAD_USERS=10 pnpm --dir examples/projects run load
```

The command generates and builds the required code, starts the local server,
runs the scenario, prints one JSON result, and closes every connection.

Supported user counts are `10`, `25`, `50`, and `100`.

## 🧪 Run the example tests

```bash
pnpm vitest run \
  examples/projects/test/proto-module.test.ts \
  examples/projects/test/topology.test.ts \
  examples/projects/test/load-runner.test.ts
```

## ⚠️ What this example does not prove

It uses in-memory storage and loopback networking. Its latency numbers are
local diagnostics, not a production benchmark or service-level objective. It
does not configure authentication, persistence, deployment, monitoring, or a
multi-machine transport.

## 🔗 Learn more

- [Server](../../packages/server/README.md)
- [Node client](../../packages/client-node/README.md)
- [Reference for coding agents](REFERENCE.md)
