# TypeScript implementation notes

The TypeScript implementation keeps Node-specific concerns at package edges:

| Concern                            | Location                     | Boundary                                |
| ---------------------------------- | ---------------------------- | --------------------------------------- |
| Generated Connect/gRPC hosting     | packages/server/src/server   | Local listener lifecycle                |
| Process-local integration messages | packages/transport/src       | Typed ExternalMessage channels          |
| Durable delivery                   | packages/server/src/delivery | Provider-owned persistence and recovery |
| Managed replicas                   | packages/server/src/server   | Coordinator and Gateway fan-out         |

Domain behavior stays in bounded contexts, entities, repositories, command
buses, and event buses. Node-specific adaptation must not broaden those public
or domain boundaries.
