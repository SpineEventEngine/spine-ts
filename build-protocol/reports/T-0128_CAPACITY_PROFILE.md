# T-0128 deterministic capacity profile

Date: 2026-08-07

This is deterministic CI evidence, not a cloud benchmark or a hard runtime
maximum. It runs on the repository's Node 24/pnpm 11.9.0 development profile,
using in-process application-node clients and a configured maximum of two
concurrent connection starts.

| Discovered nodes       | Connection-start bound | Result                                                                 |
| ---------------------- | ---------------------- | ---------------------------------------------------------------------- |
| 32 (expected)          | 2                      | Every node was created and became routable.                            |
| 40 (above expectation) | 2                      | Every node was created and became routable; 32 did not cap membership. |

Reproduce with:

```bash
pnpm exec vitest run packages/auth/test/dynamic-unary-forwarder.test.ts
pnpm exec vitest run packages/deployment-gke/test/discovery/gke-node-discovery.test.ts packages/deployment-gce/test/registry/registry-reader.test.ts
```

The GKE suite supplies controlled headless-Service DNS answers. The GCE suite
supplies controlled leased-registry snapshots, including expiry to zero and a
later node return. The dynamic subscription suite proves retained definitions
reactivate after membership returns. Real cloud throughput, latency, autoscaler
choice, storage sizing, and a multiple-Gateway topology are deliberately not
measured or claimed here.
