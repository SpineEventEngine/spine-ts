# T-0210a Evidence

| Requirement                                   | Proof                                                                                                                                                 |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Arbitrary generated domain prefix is accepted | Conformance opens both publisher and subscriber on `type.spine.examples.todo/spine.examples.todo.TaskCreated` for both factories.                     |
| Malformed values fail at both factory methods | The same conformance covers empty, whitespace, missing prefix, missing type, and doubled separator inputs for both publisher and subscriber creation. |
| No prefix policy remains                      | Shared internal predicate has no `spine.io`, `googleapis.com`, schema registry, or configuration dependency.                                          |
| Defensive-copy/lifecycle contract remains     | Existing in-memory and ZeroMQ focused suites remain green alongside conformance.                                                                      |

The validation is syntactic by design: `TransportFactory` has only `ChannelId`,
whereas schema availability/corruption handling belongs to the IntegrationBroker
consumer path.
