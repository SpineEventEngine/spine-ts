# Deployment

For operators assembling a Spine Gateway with application-node discovery. See [the reference](REFERENCE.md) for the contract.

This package is currently private to this workspace rather than published for npm installation. Workspace consumers create `ApplicationNode` values and publish initial and replacement complete sets with `StaticNodeDiscovery`. Each snapshot is authoritative membership input; the consumer reconciler compares stable IDs, canonical HTTP(S) origins, and HTTPS TLS names. The expected 32 nodes is an operational expectation, never a routing cap.
