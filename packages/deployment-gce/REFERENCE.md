# Reference

## Deployment template

The packaged `terraform` directory is an editable Google Compute Engine
reference topology. It requires existing private network/subnetwork, service
account, external configuration/secret identifiers, immutable image digests,
and application-selected durable storage. It creates a regional application
MIG, a one-instance Gateway MIG, and a one-instance in-memory delivery-server
MIG. Internal passthrough load balancers provide stable private Gateway and
delivery addresses. It intentionally creates no public edge, TLS certificate,
identity provider, storage engine, secret value, Cloud Run resource, or second
Gateway.

The application group has a 120-second default autohealing startup delay. Its
manual target size is present only when `autoscaling_enabled` is false; an
enabled regional autoscaler is the sole owner of capacity. CPU and
per-instance Monitoring metrics cannot revive a zero-instance group. A
whole-group Monitoring metric can, if the operator supplies one that continues
to exist at zero capacity.

The template uses Compute-Optimized OS plus a `docker run` startup script. It
does not use the deprecated container startup agent or a
`gce-container-declaration` metadata value.

## Metadata and node identity

`GceMetadataService.read(signal)` requests project ID, zone, numeric instance
ID, and `network-interfaces/0/ip` from the GCE metadata service. Every request
uses `Metadata-Flavor: Google`; unsuccessful, empty, or malformed responses
reject, as does cancellation. `GceMetadataProvider` is injectable for tests or
an operator-owned metadata integration.

`GceApplicationNode.create(metadata, options)` returns the stable ID
`gce/<project>/<zone>/<numeric-instance-id>`. `port` must be a safe TCP port.
Without an override the endpoint is private-address HTTP; an explicit canonical
HTTP(S) endpoint and compatible TLS server name override it. No public address
is inferred.

## Registrar

`new GceRegistrar(options)` requires either a ready `node` or a metadata port.
When `node` and `metadata` are both omitted, it creates `GceMetadataService`
automatically. It creates a UUID registration identity unless `identity` is
supplied. The injected `scheduler`, `now`, and `deadlines` seams make timing
deterministic. `operationTimeoutMs` is a positive safe integer and defaults to
20,000 milliseconds.

Call `start()` only after listener readiness. The initial record expires after
60,000 milliseconds; scheduled renewal runs at 20,000-millisecond intervals.
Initial write failure or loss leaves the registrar unconfirmed. The next cycle
looks up the exact row: the same live identity confirms it, while absence or a
different identity permits one conditional register attempt. Renewal and
cleanup are serialized with this confirmation work.

`close()` fences future ticks, aborts and joins admitted cooperative work, and
conditionally removes only the matching registration identity. It must finish
before the listener network close. A deadline never detaches an operation: the
registrar waits for the admitted promise to settle before deletion.

## Discovery

`GceRegistryReader.read(signal)` reads the full live registry snapshot at its
injected clock time, which defaults to `Date.now`. Use it with
`ScheduledNodeDiscovery`, whose production scheduler is optional and unref'ed;
expired rows are filtered immediately, so scale-to-zero produces an empty membership snapshot.
A later registrar makes its node discoverable and also resumes bounded cleanup
of abandoned expired rows. Registry-read failures retain the Gateway's previous
valid membership until a later refresh succeeds.
