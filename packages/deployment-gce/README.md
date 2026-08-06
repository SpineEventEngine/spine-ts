# GCE deployment registration

`@spine-event-engine/deployment-gce` derives a stable private GCE node identity and registers it in an explicitly supplied leased registry. The application owns the storage factory, namespace, listener readiness, and registrar lifecycle. Default renewal is 20 seconds and expiry is 60 seconds; private HTTP addressing is default, while canonical endpoint and TLS overrides are explicit.

Terraform and beginner deployment procedures are intentionally deferred to T-0127.
