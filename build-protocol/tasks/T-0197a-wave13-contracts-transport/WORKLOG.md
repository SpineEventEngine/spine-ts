# T-0197a work log

- Verified isolated branch baseline aaff3b4c.
- Retained the T-0196 RED evidence before product implementation.
- Copied frozen contracts and provenance; canonical generation updated descriptor evidence.
- Implemented only the channel SPI and in-memory factory.
- ZeroMQ message-channel implementation remains a separate handoff.

## Correction batch

- Hardened the in-memory channel adapter: copied channel/frame inputs, checked canonical channel and wrapper identity boundaries, per-publisher FIFO queueing, and close-drain sequencing.
- Added independent memory conformance tests: four tests cover fan-out/removal/staleness, concurrent FIFO plus publisher close, factory close draining, mutation isolation, and malformed input rejection.
- Updated exact source and generated module inventory counts: 46 pinned sources and 50 generated Proto files.
- Known external REDs remain: RED-14 awaits server external-messages; combined RED-21 awaits the separately-owned ZeroMQ factory export.

- Final correction: moved adapter mechanics behind a private state collaborator; public factory declaration is limited to the TransportFactory SPI. Returned IDs are fresh canonical copies and close shares one completion.
