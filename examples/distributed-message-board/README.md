# Distributed Message Board

This example runs the existing Message Board model, application package, and
React UI in a distributed development topology. It adds no copied domain or UI
code: use the packages under `../message-board/` for both.

```text
Browser -> Gateway -> application-1 or application-2 -> shared Datastore
                      \-> in-memory simple delivery server
```

## Start

Build the local images once from the repository root, then start all topology
processes with one command. Generate a local development key first; do not
commit it:

```bash
pnpm images:build:local
openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 \\
  -out examples/distributed-message-board/fixture-private-key.pem
MESSAGE_BOARD_SESSION_PRIVATE_KEY="$(cat examples/distributed-message-board/fixture-private-key.pem)" \\
  pnpm --dir examples/distributed-message-board start
```

Start the existing UI separately with its Gateway URL:

```bash
VITE_MESSAGE_BOARD_GATEWAY_URL=http://127.0.0.1:18080 \\
  pnpm --dir examples/message-board/web start
```

The Compose file starts exactly two identical Message Board application nodes,
one Gateway, one in-memory simple delivery server, and one shared Datastore
emulator. Both applications use the same application-selected storage and
delivery endpoint. The Gateway fans out only subscription notices; browser
queries remain authoritative.

Stop the topology with `Ctrl-C`, or run `docker compose --file deploy/compose.yaml down`.

## Limits

The simple delivery server is in-memory and is not highly available. Delivery
and subscription notices are best effort, so the UI always re-queries through
the single Gateway after a notice or reconnect.

See the reused [Message Board model and app](../message-board/README.md) for
the domain and UI implementation, or the [operator reference](REFERENCE.md)
for this topology's exact lifecycle and limits.
