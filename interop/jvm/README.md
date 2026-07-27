# P1 JVM interoperability fixture

This is a static-source reference for
`SpineEventEngine/core-java@461a8281e484c12636d8cf660a1d6c929fbbd7ec`.
It is not a vendored source tree and must not be patched.

## Prerequisites

- Node supported by this repository.
- `unzip` and `zipinfo`; Node performs the bounded source-archive download.

## Run and cleanup

Run `node interop/jvm/fixture.mjs`. The archive is fetched into ignored
`interop/jvm/.cache` and checksum-verified before use. Every invocation then
creates its own temporary extraction directory, validates the archive's tree
digest and static capabilities there, returns the evidence, and removes that
directory in `finally`. It never downloads a JDK or Gradle, invokes Gradle,
or runs JVM code. Success prints `JVM fixture ready (static source reference
only):` followed by all four source-surface flags.

Offline execution is expected to fail until the pinned source archive is
already cached. Remove only `interop/jvm/.cache` to discard cached archives.
The command retains neither extracted source nor revision locks between runs.

## Promotion

This command does not establish runtime JVM compatibility. Runtime build,
launch, and endpoint behavior are explicitly deferred beyond Wave 4; do not
promote the static source reference to a runtime compatibility claim.
