# Agent AI facade reference

Audience: application developers and adapter implementers.

`AiModel.define()` validates and snapshots a generation or decision capability
with Protobuf input and output descriptors. Generation may request a native
schema or use prompt-and-validate mode. `ModelRef.of()` creates a semantic
Protobuf deployment reference. `AiRegistry.create()` validates defaults, bounds,
registrations, and selection by Proto value. `Mcp.server()` validates a tool
server's policy before a context is built. These factories reject malformed
settings before a model request can begin.

The public `AgentAi` interface and history read contracts are SDK-free. The
package exports curated Agent history, content, and System-event descriptors.
The optional adapter uses the `spi/adapter` subpath for opaque deployment
callbacks. The internal runtime SPI checks exact ProtoJSON candidates and
admits decision answers. The package does not yet bind these contracts into a
server context or execute requests, tools, history reads, audit, or recovery.

Native output schemas support a conservative descriptor subset. An unsupported
field or option produces a field-specific error before dispatch. Unknown usage
stays absent in the Protobuf `AiUsage` message; a reported zero is represented
as an explicit `AiTokenCount` message.
