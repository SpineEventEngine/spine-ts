# Reference

`GceApplicationNode.create()` builds `gce/<project>/<zone>/<numeric-instance-id>` from trusted metadata. `GceRegistrar.start()` must run only after the listener is reachable. On shutdown, call `close()` before closing that listener so scheduled work is fenced and the owned lease is conditionally removed. `GceRegistryReader` supplies complete live snapshots to `ScheduledNodeDiscovery`, whose default refresh is ten seconds.
