# Deployment

For operators assembling a Spine Gateway with application-node discovery. See [the reference](REFERENCE.md) for the contract.

Install `@spine-event-engine/deployment`, create `ApplicationNode` values, and publish the initial and replacement complete sets with `StaticNodeDiscovery`. Each snapshot is authoritative: stable IDs, canonical HTTP(S) origins, and HTTPS TLS names determine equality. The expected 32 nodes is an operational expectation, never a routing cap.
