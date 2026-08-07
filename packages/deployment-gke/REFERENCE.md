# Reference

## Entrypoints

`GkeNodeDiscovery` implements the platform-neutral `NodeDiscovery` contract. It accepts a headless-Service `serviceName`, private application `port`, and an optional `http` (default) or `https` scheme. `resolver`, `scheduler`, and `now` are injectable deterministic seams. `NodeDnsResolver` is the production default and uses Node's maintained `node:dns/promises` Resolver for A and AAAA records with TTL metadata; cancellation calls `Resolver.cancel()`.

## Identity and TLS

Every complete DNS answer is deduplicated and converted into canonical HTTP(S) origins. IPv6 literals are bracketed. IDs are derived from the canonical origin and HTTPS TLS authority, so address reappearance after an absence receives fresh reconciliation work. HTTPS always uses the normalized configured Service DNS name for TLS/SNI rather than substituting the resolved IP address. HTTP does not have a TLS authority.

## Refresh and failure behavior

The default refresh interval is 10,000 milliseconds. A non-empty successful answer schedules the next read at the earlier of that interval and the smallest positive TTL. Zero, missing, or unusable TTL values use the refresh interval as both schedule and validity fallback. An empty or name-not-found answer is a successful empty snapshot applied immediately; it has no negative TTL cache and refreshes at the configured interval.

A resolver error does not replace the most recent successful non-empty answer before that answer's validity deadline. Once the deadline passes, exactly one empty snapshot is published while retries continue at the configured interval. A later success restores normal membership and TTL scheduling. `close()` cancels the timer and the admitted resolver request, waits for it to settle, and prevents later snapshot delivery.

Expected application-node count remains an operational threshold owned by the Gateway deployment; this package neither limits membership nor exports count diagnostics. Terraform, Kubernetes manifests, a Kubernetes API watch, leased registry access, and a logging adapter are deliberately outside this package.
