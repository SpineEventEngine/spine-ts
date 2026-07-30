# P1 JVM Fixture Implementation Report

Date: 2026-07-27
Worktree: `.worktrees/T-0075-wave4-browser-interoperability`
Owner: existing `implementer` role (`gpt-5.6-terra`, `medium`; explicit dispatch;
independent runtime self-introspection unavailable).

## Current behavior delivered

The human scope correction at the end of this report supersedes all earlier
runtime-build experiments and evidence. Those entries are retained as
historical diagnostics only.

The latest P1 simplification also supersedes every earlier shared-source,
revision-lock, stale-takeover, `.ready` publication, and preservation claim in
the historical correction entries below. Those mechanisms are removed rather
than retained: this static reference shares only the immutable archive cache.

- `compatibility-tests/jvm/fixture-lock.json` is an immutable static-source manifest
  for official `SpineEventEngine/core-java` revision
  `461a8281e484c12636d8cf660a1d6c929fbbd7ec`.
- Its official archive URL is pinned with SHA-256
  `bbecc94a9b2321da279f7997b50b9bc0aaab330f0ec78afe4e0d8fb971249e12`.
- `node compatibility-tests/jvm/fixture.mjs` caches only the immutable, checksum-verified
  archive in ignored `compatibility-tests/jvm/.cache/`. Each invocation uses a unique,
  caller-owned extraction directory, bounds streamed download/archive metadata,
  rejects absolute/traversing or unexpected-root entries, validates internal
  symbolic-link containment, and tree-hashes the extracted upstream source
  before static capabilities are read. It removes that extraction directory in
  `finally` and returns only archive path, source digest, and capabilities.
- Source capability evidence requires native `CommandService`, `QueryService`,
  and `SubscriptionService` (which takes `Topic` targets, including
  Projections). Native event subscription evidence is `TopicValidator` accepting
  `EventMessage` targets and `EventUpdateHandler` producing `EventUpdates`.
- The workflow has no Gradle, JDK, JVM build, or runtime launch path. It neither
  vendors nor patches Spine JVM.
- The cache is ignored and no upstream source, submodule, or vendor tree was
  added.

## Behavior-first TDD evidence

RED, initial missing implementation:

```text
pnpm --config.verify-deps-before-run=false exec vitest run compatibility-tests/jvm/fixture.test.mjs
FAIL: Cannot find module './fixture.mjs'
```

GREEN, checksum, clean-tree, and capability guards:

```text
pnpm --config.verify-deps-before-run=false exec vitest run compatibility-tests/jvm/fixture.test.mjs
Test Files  1 passed
Tests       4 passed (4)
```

RED, expanded archive-safety/event-exposure behavior:

```text
pnpm --config.verify-deps-before-run=false exec vitest run compatibility-tests/jvm/fixture.test.mjs
Tests       2 failed | 3 passed (5)
Failures: absent eventSubscription capability; assertSafeArchiveEntries is not a function
```

GREEN, final focused suite:

```text
pnpm --config.verify-deps-before-run=false exec vitest run compatibility-tests/jvm/fixture.test.mjs
Test Files  1 passed (1)
Tests       5 passed (5)
```

Additional focused checks:

```text
pnpm exec prettier --check compatibility-tests/jvm/fixture.mjs compatibility-tests/jvm/fixture.test.mjs compatibility-tests/jvm/fixture-lock.json vitest.config.ts
All matched files use Prettier code style!

git diff --check
exit 0
```

Archive evidence, fetched directly from the pinned official URL:

```text
bbecc94a9b2321da279f7997b50b9bc0aaab330f0ec78afe4e0d8fb971249e12  /private/tmp/core-java-461a8281.zip
```

## Files changed

- `.gitignore` — ignores the fixture cache.
- `vitest.config.ts` — discovers only `compatibility-tests/jvm` focused tests.
- `compatibility-tests/jvm/fixture.mjs` — deterministic workflow and guards.
- `compatibility-tests/jvm/fixture.test.mjs` — focused behavior tests.
- `compatibility-tests/jvm/fixture-lock.json` — pinned provisional inputs/capabilities.
- This report.

## Current limitation

This reference proves source identity and statically observed service surfaces
only. By explicit human instruction, Wave 4 does not build or launch Spine JVM.
Runtime interoperability evidence is deferred and must not be inferred from
this reference.

## Latest simplification — archive-only cache

Behavior-first replacement evidence:

```text
RED: 3 failed / 8 focused tests
- old workflow returned a retained `extracted` path
- it retained shared `staging`/source publication state after a timed-out run

GREEN:
pnpm --config.verify-deps-before-run=false exec vitest run compatibility-tests/jvm/fixture.test.mjs
Test Files  1 passed (1)
Tests       8 passed (8)
```

The focused tests now cover immutable archive checksum verification, fail-closed
entry/metadata/link limits, symlink-aware tree identity, capabilities, byte
streaming limits, and a timeout through `prepareFixture()` that first writes a
chunk, stalls, and removes its randomized partial archive and all run staging
before a successful retry. Three concurrent callers independently validate one
verified archive, return no extracted path, and leave no staging or source
tree. Staged capability and pinned-digest failures likewise leave no retained
extraction. No lock, takeover, `.ready`, or shared-source recovery behavior is
present or required by this design.

Configured owner metadata is the existing `implementer` role with explicit
`gpt-5.6-terra` / `medium` dispatch. Independent runtime self-introspection is
not exposed by this surface; that is the only metadata limitation.

## Latest correction — concurrent staging ownership

The first archive-only cleanup removed the shared `staging` parent recursively
after deleting its own randomized child. That could delete a second caller's
active child. A forced-overlap RED test paused one caller immediately after
extraction, let a second caller finish, and failed because the pause hook was
not yet available. After the correction, the test pauses the first caller,
confirms the second caller completes, resumes the first caller successfully,
and confirms all artifacts are then gone.

```text
RED: 1 failed / 9 focused tests — extraction did not pause
GREEN: 1 file passed / 9 focused tests
```

`finally` always recursively removes only the caller-owned randomized staging
directory. It then attempts a non-recursive `rmdir` of the shared parent and
ignores only `ENOTEMPTY` and `ENOENT`; it cannot recursively remove another
caller's work. The injectable post-extraction hook exists solely for this
focused interleaving test and does not invoke JVM code.

## Latest correction — incremental archive checksum

Archive checksum verification now reads through a Node stream and feeds each
chunk directly into SHA-256 rather than using `readFile()` to buffer up to the
256 MiB archive limit per concurrent caller. The RED regression supplied an
injected multi-chunk stream for a nonexistent path, which failed while the
implementation attempted `readFile`; GREEN opens the injected stream and
returns its expected digest. A companion test proves stream failures propagate.
Checksum mismatch handling, randomized-part cleanup, and download byte/time
bounds remain covered by the same focused suite.

```text
RED: 1 failed / 10 focused tests — ENOENT from readFile
GREEN: 1 file passed / 11 focused tests
```

## Historical correction record

All remaining sections predate the archive-only simplification and are retained
solely for audit history. Their shared-source, lock, takeover, `.ready`, and
publication descriptions are superseded by the behavior above.

## Correction batch — archive root and native event capability

The first implementation incorrectly treated extraction as if `unzip` created
files directly under `.cache/source/<sha>`. A locked GitHub archive instead
creates `.cache/source/<sha>/<archiveRoot>`. The new end-to-end regression
constructs a ZIP with that top-level root and verifies the extracted path before
the wrapper and capability inputs are read.

It also corrects the event capability claim. `Server.Builder.include` only
proves extension by arbitrary services; it does not prove events are
subscribable. The lock and checker now require the native `SubscriptionService`
path, `TopicValidator`'s `EventMessage.class.isAssignableFrom(targetClass)`,
and `EventUpdateHandler` evidence.

RED correction evidence:

```text
pnpm --config.verify-deps-before-run=false exec vitest run compatibility-tests/jvm/fixture.test.mjs
Tests       2 failed | 4 passed (6)
- ENOENT: .cache/source/<sha>/gradle/wrapper/gradle-wrapper.jar
- required JVM service capability is absent: eventSubscription
```

GREEN correction evidence:

```text
pnpm --config.verify-deps-before-run=false exec vitest run compatibility-tests/jvm/fixture.test.mjs
Test Files  1 passed (1)
Tests       6 passed (6)

node --check compatibility-tests/jvm/fixture.mjs
exit 0

pnpm exec prettier --check compatibility-tests/jvm/fixture.mjs compatibility-tests/jvm/fixture.test.mjs compatibility-tests/jvm/fixture-lock.json build-protocol/tasks/T-0075-wave4-browser-interoperability/P1_IMPLEMENTATION_REPORT.md
All matched files use Prettier code style!

git diff --check
exit 0
```

Coordinator offline-probe evidence (exact pinned upstream SHA):

```text
./gradlew --offline --no-daemon :server:classes
Gradle 9.6.1 / installed JDK started, then failed in
:buildSrc:generateExternalPluginSpecBuilders because
org.jetbrains.kotlinx:kover-gradle-plugin:0.9.9 was not cached.
```

This is an offline dependency-cache limitation, not successful detached build
or launch evidence, so the fixture remains provisional.

## Review correction batch — hardening

RED before this correction:

```text
pnpm --config.verify-deps-before-run=false exec vitest run compatibility-tests/jvm/fixture.test.mjs
Test Files  1 failed (1)
Tests       3 failed | 5 passed (8)
Failures: file-global capability evidence rejected file-specific native inputs;
archive metadata and wrapper-property guards were not implemented.
```

GREEN after correction:

```text
pnpm --config.verify-deps-before-run=false exec vitest run compatibility-tests/jvm/fixture.test.mjs
Test Files  1 passed (1)
Tests       8 passed (8)

node --check compatibility-tests/jvm/fixture.mjs
exit 0

pnpm exec prettier --check compatibility-tests/jvm/fixture.mjs compatibility-tests/jvm/fixture.test.mjs compatibility-tests/jvm/fixture-lock.json compatibility-tests/jvm/README.md build-protocol/tasks/T-0075-wave4-browser-interoperability/P1_IMPLEMENTATION_REPORT.md
All matched files use Prettier code style!

git diff --check
exit 0
```

The lock now records the 1 GiB expanded-size ceiling; the official Gradle 9.6.1
distribution URL and SHA-256
`9c0f7faeeb306cb14e4279a3e084ca6b596894089a0638e68a07c945a32c9e14`; the
upstream Java 17 target; and an exact unmodified-source test selection:
`CommandServiceTest`, `QueryServiceTest`, `SubscriptionServiceTest`, and
`EventSubscriptionRequestTest`. The checker requires the wrapper properties to
declare that locked distribution checksum before a probe proceeds. The pinned
upstream wrapper does not currently declare it, so this is an intentional
provisional preflight failure until checksum-backed wrapper resolution can be
provided without patching upstream.

`compatibility-tests/jvm/README.md` documents prerequisites, online/offline behavior,
success output, cache cleanup, and the exact promotion evidence. No real
Command/Query/Projection/Event execution occurred in this correction.

## Reliability correction batch — staged publication and unmodified wrapper

RED, before the replacement reliability work:

```text
pnpm --config.verify-deps-before-run=false exec vitest run compatibility-tests/jvm/fixture.test.mjs
Test Files  1 failed
Tests       3 failed | 6 passed (9)
Failures: internal-safe symlinks were rejected; the unmodified upstream wrapper
was incorrectly required to declare distributionSha256Sum; no link validator
was exported.
```

GREEN:

```text
pnpm --config.verify-deps-before-run=false exec vitest run compatibility-tests/jvm/fixture.test.mjs
Test Files  1 passed (1)
Tests       10 passed (10)

node --check compatibility-tests/jvm/fixture.mjs
exit 0
```

The archive download now writes to a per-run temporary file, enforces the
archive bound and checksum before atomic publication, and removes temporary
files on failure. Extraction uses a per-run staging directory and publishes
only after wrapper-JAR verification. The revision lock has bounded retry and
stale-owner recovery. Build copies are per-run and removed in `finally`.

ZIP symbolic links are no longer rejected wholesale. Each link target is read
from archive content and is accepted only when its resolved target remains
inside the locked archive root; absolute and escaping targets are rejected.
This accommodates the official archive's internal symlinks without granting
write-through escape paths.

The upstream `gradle-wrapper.properties` is intentionally unmodified and does
not declare `distributionSha256Sum`. The fixture instead verifies the locked
distribution URL, downloads the exact locked ZIP into the isolated cache,
checksums it before atomic publication, then pre-seeds that isolated wrapper
distribution cache before invoking the unmodified wrapper. URL mismatch and
checksum mismatch remain focused guard behavior.

The end-to-end prepare regression now runs two simultaneous prepares for the
same revision, asserts lock release and no retained per-run build directory,
forces a source mutation during the detached command, observes the source
digest failure, and then retries successfully. This is focused simulation
evidence for serialization, cleanup, mutation detection, and retry behavior;
it is not evidence that an online Gradle build has run.

Remaining limitation: a permitted online detached Gradle build and exact native
Command/Query/Projection/Event test execution still have not run. The status
remains provisional; the correction does not promote or claim runtime
interoperability.

## Real-probe retry correction — idempotent wrapper cache preseed

The first authorized real-probe run reached the unmodified Gradle wrapper and
populated/used its isolated wrapper cache. It did not supply completed native
endpoint evidence. A retry with corrected `JAVA_HOME` then failed before the
probe with `ENOTEMPTY` while renaming
`<distribution-hash>.<uuid>.stage` to the existing `<distribution-hash>`.

RED:

```text
pnpm --config.verify-deps-before-run=false exec vitest run compatibility-tests/jvm/fixture.test.mjs
Test Files  1 failed (1)
Tests       1 failed | 10 passed (11)
Failure: an already prepared wrapper cache extracted gradle-9.6.1, while the
preseed readiness check incorrectly required gradle-9.6.1-bin and attempted
another staging publication.
```

GREEN:

```text
pnpm --config.verify-deps-before-run=false exec vitest run compatibility-tests/jvm/fixture.test.mjs
Test Files  1 passed (1)
Tests       11 passed (11)

node --check compatibility-tests/jvm/fixture.mjs
exit 0
```

The preseed now recognizes Gradle's real extracted directory name
`gradle-9.6.1`. A checksum-verified existing archive with that directory is
reused without deletion or overwrite. If only the hash directory exists, the
freshly extracted distribution directory is atomically installed beneath it;
the live valid cache is never replaced. Archive checksum verification remains
mandatory before either path.

## Upstream KSP diagnostic

Owner metadata for this diagnostic remains the explicitly dispatched existing
`implementer` role, configured as `gpt-5.6-terra` with `medium` reasoning.
Independent runtime self-introspection is unavailable; the immutable configured
profile is the available metadata evidence.

The corrected-`JAVA_HOME` real probe reached Gradle 9.6.1 and failed in the
exact launch-test path at `:server:kspTestFixturesKotlin` after 78 actionable
tasks (48 executed, 30 up-to-date). Its daemon record identifies the launcher
as Homebrew OpenJDK 21 at
`/opt/homebrew/Cellar/openjdk/21.0.3/libexec/openjdk.jdk/Contents/Home`.
This satisfies the locked "Java 17 or newer" launcher requirement, so the
failure is not a launcher/toolchain-selection failure.

The retained Gradle diagnostic is:

```text
Execution failed for task ':server:kspTestFixturesKotlin'.
KSP failed with exit code: PROCESSING_ERROR
DrawingContext.kt:124: Unqualified function encountered: ...DrawingEvents.Companion.route
SortingContext.kt:153: Unqualified function encountered: ...FigureStatsView.Companion.byFigure
FizzBuzzContext.kt:98: Unqualified function encountered: ...NumberQualification.Companion.qualify
FizzBuzzContext.kt:113: Unqualified function encountered: ...NumberQualification.Companion.routeEvent
```

The retained probe was executed through the fixture's locked command sequence:

```text
node compatibility-tests/jvm/fixture.mjs
# detached commands: ./gradlew --no-daemon :server:classes
# then ./gradlew --no-daemon :server:test --tests io.spine.server.CommandServiceTest
# --tests io.spine.server.QueryServiceTest --tests io.spine.server.SubscriptionServiceTest
# --tests io.spine.client.EventSubscriptionRequestTest
```

An additional read-only task-graph attempt used:

```text
JAVA_HOME=/opt/homebrew/Cellar/openjdk/21.0.3/libexec/openjdk.jdk/Contents/Home \
GRADLE_USER_HOME=compatibility-tests/jvm/.cache/gradle ./gradlew --no-daemon :server:classes --dry-run
```

It was blocked in this sandbox before task execution by Gradle file-lock socket
creation (`java.net.SocketException: Operation not permitted`), so it neither
changes nor weakens the retained real-probe diagnosis.

Those sources are in the pinned upstream `server/src/testFixtures` tree. Its
`BuildExtensions.kt` explicitly wires `compileTestFixturesKotlin` to
`kspTestFixturesKotlin`; the exact locked `:server:test --tests ...` launch
selection legitimately requires those fixtures. Skipping them or substituting
a smaller test task would evade, rather than prove, the required native launch
evidence. The diagnostic therefore identifies an upstream/pinned-revision KSP
processing incompatibility or upstream fixture defect, not a fixture task
selection correction.

RED diagnostic-output regression:

```text
pnpm --config.verify-deps-before-run=false exec vitest run compatibility-tests/jvm/fixture.test.mjs
Test Files  1 failed (1)
Tests       1 failed | 11 passed (12)
Failure: describeGradleFailure is not a function
```

GREEN:

```text
pnpm --config.verify-deps-before-run=false exec vitest run compatibility-tests/jvm/fixture.test.mjs
Test Files  1 passed (1)
Tests       12 passed (12)

node --check compatibility-tests/jvm/fixture.mjs
exit 0
```

Fixture Gradle command failures now retain the failing task, up to eight KSP
source diagnostics, and the pinned-upstream/KSP classification. The source,
archive checksum, wrapper checksum, and lock inputs remain unmodified. This is
diagnostic evidence only: no successful real probe occurred and the fixture
remains provisional.

## Exact CI-aligned Java 17 launcher correction

The prior "Java 17 or newer" wording was too permissive. The pinned upstream
CI uses Zulu 17, so a local Java 21 launcher is not equivalent acceptance
evidence even though it exceeds the source target. The lock now pins Azul
metadata UUID `fa19a050-71b2-4d90-b496-a69aa94ec33d`, Zulu 17.0.20+8 macOS
AArch64 archive URL, maximum archive-size bound `191677000`, and SHA-256
`0da52534760b74ba8a42660384b2f4e44311a47ae52faa45fcbd829b2797b244`.

RED:

```text
pnpm --config.verify-deps-before-run=false exec vitest run compatibility-tests/jvm/fixture.test.mjs
Test Files  1 failed (1)
Tests       1 failed | 12 passed (13)
Failure: assertExactJavaHome is not a function; Java 21 was not rejected.
```

GREEN:

```text
pnpm --config.verify-deps-before-run=false exec vitest run compatibility-tests/jvm/fixture.test.mjs
Test Files  1 passed (1)
Tests       14 passed (14)

node --check compatibility-tests/jvm/fixture.mjs
exit 0
```

The fixture now downloads to a per-run temporary file under ignored
`compatibility-tests/jvm/.cache/java`, applies the exact byte bound and SHA-256 before
atomic archive publication, validates TAR entry paths, atomically extracts the
locked launcher, and invokes Gradle with that exact `JAVA_HOME` and its `bin`
directory first on `PATH`. The test suite rejects `/opt/jdk-21` and verifies
extraction of a maximum-size-bounded and checksum-locked launcher archive into the isolated
cache. No real Java archive download or authoritative probe was performed in
this correction; the coordinator must run that probe before any promotion.

## Zulu metadata-size correction

The official CDN reports `Content-Length: 191676948` for the exact locked Zulu
URL, while published metadata supplied `191677000`. The latter is now named
`maximumArchiveBytes` and enforced only as an upper bound. SHA-256 remains the
mandatory identity check; byte count is not an identity surrogate.

RED:

```text
pnpm --config.verify-deps-before-run=false exec vitest run compatibility-tests/jvm/fixture.test.mjs
Test Files  1 failed (1)
Tests       1 failed | 14 passed (15)
Failure: assertArchiveSize is not a function; the launcher equality requirement
could not distinguish a valid shorter CDN artifact from an oversized artifact.
```

GREEN:

```text
pnpm --config.verify-deps-before-run=false exec vitest run compatibility-tests/jvm/fixture.test.mjs
Test Files  1 passed (1)
Tests       15 passed (15)

node --check compatibility-tests/jvm/fixture.mjs
exit 0
```

The focused boundary regression accepts `191676948 <= 191677000` and rejects
`191677001`. The launcher download passes the maximum to curl and applies the
same bound after download before checksum verification and atomic publication.
No real probe was run and the fixture remains provisional.

## Human scope correction — static source reference only

The user has explicitly prohibited building Spine JVM during Wave 4 because of
cost. This section supersedes earlier report entries describing Gradle,
distribution, JDK, detached-build, launcher, KSP, or runtime-probe work. Those
entries remain historical diagnostics only and are not current fixture behavior
or promotion criteria.

The lock and workflow now retain only the official repository/revision/archive
identity, bounded atomic archive fetch, safe extraction including validated
internal symlinks, source digest, and file-specific static Command, Query,
Projection-subscription, and Event-subscription surface evidence. Gradle
distribution/JDK preparation, build staging, Gradle tasks, runtime probes, and
their tests/claims have been removed. The CLI explicitly labels success as a
"static source reference only" result; runtime JVM compatibility is deferred.

RED:

```text
pnpm --config.verify-deps-before-run=false exec vitest run compatibility-tests/jvm/fixture.test.mjs
Test Files  1 failed (1)
Tests       1 failed | 14 passed (15)
Failure: the fixture attempted to execute <cache>/build/<revision>/<run>/gradlew
after the test callback rejected every Gradle/JDK/build command.
```

GREEN:

```text
pnpm --config.verify-deps-before-run=false exec vitest run compatibility-tests/jvm/fixture.test.mjs
Test Files  1 passed (1)
Tests       8 passed (8)

node --check compatibility-tests/jvm/fixture.mjs
exit 0
```

The end-to-end static fixture regression runs concurrent prepares with an
execution callback that rejects `gradlew`, `curl`, and `tar`; the cached fixture
uses only ZIP inspection/extraction, returns static capabilities plus a source
digest, and releases its revision lock. No Spine JVM build was run, and no
runtime compatibility claim is made.

## Static-only review hardening batch

RED:

```text
pnpm --config.verify-deps-before-run=false exec vitest run compatibility-tests/jvm/fixture.test.mjs
Test Files  1 failed (1)
Tests       1 failed | 8 passed (9)
Failure: parseArchiveMetadata is not a function; normalized
<archive-root>/../unexpected entries were not checked against the locked root.
```

GREEN:

```text
pnpm --config.verify-deps-before-run=false exec vitest run compatibility-tests/jvm/fixture.test.mjs
Test Files  1 passed (1)
Tests       12 passed (12)

node --check compatibility-tests/jvm/fixture.mjs
exit 0
```

The ZIP metadata parser now has a real `zipinfo -l` row regression; entry paths
are normalized and required to remain beneath the locked root, and link targets
are separately contained. Source identity is pinned in the lock as
`sourceTreeSha256`; its deterministic digest includes relative paths, modes,
file content, directory markers, symlink paths, and symlink targets before
static capabilities are accepted. File and symlink-target mutation regressions
prove digest changes.

Revision locking now renews a live owner, releases deterministically, and
recovers stale owner and stale ownerless directories. Focused held/stale/
ownerless/slow-owner coverage verifies that a waiting prepare cannot steal a
renewing owner. Interrupted `.ready` source publications are removed before a
retry. Source downloads now pass curl `--max-filesize`, `--connect-timeout 15`,
and `--max-time 120`, with a focused argument regression. No JDK, Gradle,
build, or JVM execution was added or run.

## Coordinator lock correction

The former fixed 100-attempt retry loop had an approximately one-second wait
budget, shorter than a real cached static preparation. It also used asynchronous
timer writes that could race lock release. The lock now uses a five-minute
default deadline and a same-host `{pid, token, startedAt}` owner record. A live
PID holds the lock without background renewal; only a dead owner older than the
safe stale age, or an ownerless directory older than that age, is recovered.
Release removes only the matching token's directory, so a delayed owner cannot
remove or recreate another owner's marker.

Focused evidence:

```text
pnpm --config.verify-deps-before-run=false exec vitest run compatibility-tests/jvm/fixture.test.mjs
Test Files  1 passed (1)
Tests       13 passed (13)
```

The deterministic coverage holds a live lock for more than one second while a
waiter remains pending, then confirms successful acquisition after release and
confirms no post-release owner marker. Existing held, stale, ownerless, and
slow-owner cases remain covered. No JVM tooling was run.

## Final static-only P1 hardening

RED began with ZIP metadata/root-containment behavior: the parser was not
exported and normalized `<root>/../unexpected` paths were not rejected.

GREEN:

```text
pnpm --config.verify-deps-before-run=false exec vitest run compatibility-tests/jvm/fixture.test.mjs
Test Files  1 passed (1)
Tests       13 passed (13)

node --check compatibility-tests/jvm/fixture.mjs
exit 0
```

Archive retrieval is now Node-owned streaming fetch with byte counting during
unknown-length body consumption and an abortable total timeout. It writes only
to the `.part` staging file, rejects overflow, checksums before atomic
publication, and requires no `curl` prerequisite. ZIP inspection now fails
closed unless `zipinfo -l` metadata has a one-to-one mapping with `unzip -Z1`
entries. The source digest and static capability predicates run against staging
before publication, so a bad digest cannot replace an existing source. Stale
locks are atomically renamed to an isolated quarantine path before removal.
The runbook now says exactly that the static workflow never downloads a JDK or
Gradle. No JVM build was run.

## Final assigned regression closure

The end-to-end static fixture suite now builds real ZIP archives for both an
expanded-size overflow and a `zip -y` escaping symbolic link. Each is rejected
by `prepareFixture()` before source publication, exercising `zipinfo -l`,
`unzip -p`, metadata containment, and the publication boundary rather than only
helper predicates. Two concurrent waiters also take over one stale generation
serially and leave no surviving lock directory.

The normal end-to-end fixture now first publishes a valid static source, then
uses a wrong `sourceTreeSha256` to force a staged digest mismatch. It proves the
previous published capability source remains readable, restores the correct
lock, and retries successfully. These checks also cover staging cleanup and
retry behavior without invoking a JVM.

Final focused evidence:

```text
pnpm --config.verify-deps-before-run=false exec vitest run compatibility-tests/jvm/fixture.test.mjs
Test Files  1 passed (1)
Tests       15 passed (15)
```

## P1 acceptance hardening

The ZIP metadata comparison now counts exact path occurrences, rejecting a
duplicate/missing multiplicity even when a set comparison would match. Node
streaming downloads expose an injected `fetchImpl` and timeout for deterministic
tests; a stalled abort-aware body is aborted and leaves no partial output.

Focused verification after these additions:

```text
pnpm --config.verify-deps-before-run=false exec vitest run compatibility-tests/jvm/fixture.test.mjs
Test Files  1 passed (1)
Tests       17 passed (17)
```

## Generation-serialized stale takeover

Stale takeover now carries the exact raw owner-record generation that was
classified stale. A per-lock takeover gate serializes compare-and-quarantine:
after entering the gate, a contender may rename only if that observed owner
record is still current. The deterministic barrier regression pauses observer A
after it classifies generation G, lets B quarantine G and acquire replacement
G2, then resumes A and proves G2's owner survives until B releases it.

## Final P1 integration cases — timeout and capability rejection

Owner metadata remains the explicitly dispatched existing `implementer` role,
configured as `gpt-5.6-terra` with `medium` reasoning. Independent runtime
self-introspection is unavailable on this surface; the immutable configured
role/profile is the available metadata evidence.

RED added both missing end-to-end `prepareFixture()` cases. The first supplied
an abort-aware, unknown-length stalled response on an empty cache with a
10-millisecond injected timeout. The second published a valid fixture, then
supplied an archive whose lock-pinned source-tree digest was correct but whose
`EventUpdateHandler` evidence was incomplete. Before the deterministic fetch
seam, both cases attempted the `fixture://` URL rather than their injected
responses:

```text
pnpm --config.verify-deps-before-run=false exec vitest run compatibility-tests/jvm/fixture.test.mjs
Test Files  1 failed (1)
Tests       2 failed | 18 passed (20)
Failures: expected "download aborted", received "fetch failed"; injected
valid archive also failed with "fetch failed" (unknown fixture URL scheme).
```

GREEN threads only optional `fetchImpl` and `downloadTimeoutMs` through the
existing `prepareFixture()` downloader. Its scoped `finally` cleanup now also
removes the empty revision staging parent under the held revision lock. The
timeout integration proves abort, no `.part`, no final archive/source/staging/
`.ready` publication, and successful valid-response retry. The capability
integration proves the prior published source retains identical bytes and tree
digest, the failed staged tree and ready paths are absent, and a corrected lock
and archive retry succeeds.

```text
pnpm --config.verify-deps-before-run=false exec vitest run compatibility-tests/jvm/fixture.test.mjs
Test Files  1 passed (1)
Tests       20 passed (20)
```

No Spine JVM, Java, Gradle, or JVM build/runtime command was run for this
correction. The tests create and inspect local ZIP fixtures only; runtime
interoperability remains deferred.
