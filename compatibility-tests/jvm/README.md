# JVM compatibility-test tooling

This directory is repository test tooling, not an npm package or a runtime
module. It holds checks that compare selected static evidence from a pinned
Spine JVM source archive with this repository's Proto and TypeScript fixtures.

## Who uses it and when

Framework maintainers run these checks when changing the compatibility
fixtures, the related Proto sources, or the archive-validation tooling. Normal
application developers do not need to run them for application work.

## What the checks do

The fixture check downloads the pinned `SpineEventEngine/core-java` source
archive when it is not cached. It verifies the archive SHA-256, extracts it to
a temporary directory, verifies the extracted source-tree checksum, and makes
static Java source checks for the expected service capabilities.

The wire check performs a deliberately partial Proto and wire comparison. It
compares the available closure and reports the current known limitation: these
six imported Proto files are not present in this repository:

- `spine/base/error.proto`
- `spine/base/field_path.proto`
- `spine/net/email_address.proto`
- `spine/net/internet_domain.proto`
- `spine/time/time.proto`
- `spine/ui/language.proto`

The check fails closed rather than claiming a complete comparison.

## Commands

From the repository root, run the complete focused suite:

```sh
pnpm test:compatibility:jvm
```

To run the static archive/source check alone:

```sh
node compatibility-tests/jvm/fixture.mjs
```

## Cache and network behavior

The pinned archive is stored in the ignored
`compatibility-tests/jvm/.cache` directory. The first run needs network access
to download it; later runs can use the verified cached archive. Offline runs
fail until that archive is already cached. Temporary extracted source is
removed after every run. Remove `compatibility-tests/jvm/.cache` to discard the
cache and require a fresh verified download.

## Limitations

Neither check builds or runs the JVM project. They do not download a JDK or
Gradle, invoke Gradle, or establish JVM runtime compatibility.
