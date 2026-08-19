# T-0210a Evidence

| Requirement                                   | Proof                                                                                                                                                                                                                   |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Arbitrary generated domain prefix is accepted | Conformance opens both publisher and subscriber on ordinary and URI/path-prefixed type URLs, including `https://types.example/v1/spine.todo.TaskCreated`, for both factories.                                           |
| Malformed values fail at both factory methods | The same conformance covers empty, whitespace, missing prefix, missing type, doubled separator, trailing segment separator, empty segment, and digit-leading segment inputs for both publisher and subscriber creation. |
| No prefix policy remains                      | Shared internal predicate has no `spine.io`, `googleapis.com`, schema registry, or configuration dependency.                                                                                                            |
| Defensive-copy/lifecycle contract remains     | Existing in-memory and ZeroMQ focused suites remain green alongside conformance.                                                                                                                                        |

The validation is syntactic by design: `TransportFactory` has only `ChannelId`,
whereas schema availability/corruption handling belongs to the IntegrationBroker
consumer path.

The first scoped preflight terminal result is unavailable after its displayed
Proto/build stages; it is not represented as a successful gate. The first
review correction and its independent focused checks are recorded in `WORKLOG`.
The correction's changed executable line and branch coverage is 100%; the
larger selected-file historical coverage is not used as the changed-code metric.
