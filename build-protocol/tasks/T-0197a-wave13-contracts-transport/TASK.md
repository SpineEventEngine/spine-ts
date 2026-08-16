# T-0197a — Wave 13 Proto and message-channel contracts

- Role: existing implementer.
- Configured profile: gpt-5.6-terra / medium; child spawning prohibited.
- Runtime telemetry: unavailable; immutable configured profile recorded.
- Scope: exact broker/transport Proto intake, typed message-channel SPI, in-memory adapter only.

## Mechanical dependency disposition

Pinned broker.proto imports spine/core/bounded_context.proto, absent from prior TS intake. T-0197a copies it byte-for-byte from core-jvm 0779b5fa42ca5cebd0d2935fc3a3489ab47846dc, source core/src/main/proto/spine/core/bounded_context.proto, SHA-256 3de46d3cd15321040a5090a7a56b457863b9b135bc2854de42f8c224091919d3. It is the existing JVM BoundedContextName wire type required by the prescribed wrapper and online documents; it adds no TypeScript concept beyond the generated dependency.
