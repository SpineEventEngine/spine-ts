# T-0041 Security Findings and Evidence

Status: Initial evidence report. Dedicated `security_reviewer` has not run;
T-0041 is not complete.

Baseline: `39f2c6f7`. Artifact source HEAD:
`6f4e9bca5993932d348f6009856406f28dae1a64`.

## Command and evidence ledger

| Source                               | Command/evidence                                                                      | Result                                                                                                                                                                                        | Attribution                                       |
| ------------------------------------ | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Coordinator                          | Frozen offline install                                                                | No lockfile mutation; only `@bufbuild/buf` and `zeromq` allowed build scripts; no ignored builds.                                                                                             | Coordinator-run; `work-logs/T-0041.md`.           |
| Coordinator, 2026-07-14, pnpm 11.9.0 | `pnpm audit --json`                                                                   | Exit 0; zero advisories; 7 dependencies + 228 dev + 40 optional = 235.                                                                                                                        | Coordinator-run native/network-complete evidence. |
| Coordinator, 2026-07-14, pnpm 11.9.0 | `pnpm audit --prod --json`                                                            | Exit 0; zero advisories; 7 total.                                                                                                                                                             | Coordinator-run native/network-complete evidence. |
| Coordinator, 2026-07-14, pnpm 11.9.0 | `pnpm audit --dev --json`                                                             | Exit 0; zero advisories; 1 dependency + 188 dev = 189.                                                                                                                                        | Coordinator-run native/network-complete evidence. |
| Coordinator, 2026-07-14, pnpm 11.9.0 | `pnpm audit signatures`                                                               | Exit 0; 235 audited and all 235 verified.                                                                                                                                                     | Coordinator-run native/network-complete evidence. |
| Coordinator                          | `pnpm --config.verify-deps-before-run=false proto:generate`                           | Exit 0; 25 copied Spine checksums verified.                                                                                                                                                   | Coordinator-run fresh-worktree evidence.          |
| Coordinator                          | `typecheck:build:generated` after generation                                          | Exit 0.                                                                                                                                                                                       | Coordinator-run fresh-worktree evidence.          |
| Coordinator                          | Splitter-defined 19-file security regression command after generation                 | Native pass: 19 files, 780 tests, 0 failures.                                                                                                                                                 | Coordinator-run focused verification evidence.    |
| Coordinator, 2026-07-14, pnpm 11.9.0 | `pnpm view zeromq@6.5.0 version dist.integrity scripts engines os cpu --json`         | Exit 0; integrity `sha512-vWOrt19lvcXTxu5tiHXfEGQuldSlU+qZn2TT+4EbRQzaciWGwNZ99QQTolQOmcwVgZLodv+1QfC6UZs2PX/6pQ==`; install script `node ./script/install.js`; Node >=12.                    | Coordinator-run registry verification.            |
| Coordinator, 2026-07-14, pnpm 11.9.0 | `pnpm view @bufbuild/buf@1.71.0 version dist.integrity scripts engines os cpu --json` | Exit 0; integrity `sha512-GDcjBCwLgHT/4nX4YSnYatZ7sDZDpHV6dxQvoT2/P6gKvV23O6hl8NryzLIRKmeau0FRXpQKHVy1dMfnBSpy+w==`; postinstall `node ./install.js`, prepack `node ./prepack.js`; Node >=12. | Coordinator-run registry verification.            |
| Artifact author                      | `git rev-parse HEAD`                                                                  | `6f4e9bca5993932d348f6009856406f28dae1a64`.                                                                                                                                                   | Author-run read-only check.                       |
| Artifact author                      | `git ls-files 'packages/*/generated/**' 'examples/*/generated/**'`                    | No output: no generated output tracked.                                                                                                                                                       | Author-run read-only check.                       |

## Dependency reachability and install scripts

| Category                     | Packages/reachability                                                                                                                                             | Evidence/disposition                                                                                                                 |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Runtime direct               | `@bufbuild/protobuf@2.12.1`, `@connectrpc/connect@2.1.2`, `@connectrpc/connect-node@2.1.2`, `@spine-event-engine/validation-ts@2.0.0-snapshot.4`, `zeromq@6.5.0`. | `packages/{core,server,storage,transport}/package.json`; `pnpm-lock.yaml:49-58,77-83,143-146`.                                       |
| Development/build            | `@bufbuild/buf@1.71.0` and tooling.                                                                                                                               | Root `package.json:18-48`; Buf is dev-only and used by `proto:generate`.                                                             |
| Runtime exposure constrained | `zeromq@6.5.0`.                                                                                                                                                   | Direct transport dependency, reachable only through explicit `@spine-ts/transport/zeromq` (`packages/transport/package.json:11-23`). |
| Audit-unreachable            | No advisory package in full, prod, or dev audit output.                                                                                                           | This does not claim all transitive packages are unreachable.                                                                         |
| Accepted install residual    | Native `zeromq`; Buf platform binary.                                                                                                                             | Only allowed build-script packages; exact registry scripts above; no ignored builds.                                                 |

`@bufbuild/buf` is root dev dependency used by `proto:generate`
(`package.json:28-31,36-38`) and has platform optionals
(`pnpm-lock.yaml:171-213,1274-1303`). `zeromq` is direct runtime dependency
of adapter-only transport; native sockets are imported only at
`packages/transport/src/zeromq/signal-transport.ts:1-7`. These scripts are
supply-chain exposure needing lock/signature review, not discovered defects.
The initial pre-generation focused-regression attempt is invalid setup and is
superseded by the successful generated-output rerun above. Generated outputs
remain ignored.

## Findings

No confirmed framework vulnerability is recorded in this initial artifact.
Stable IDs preserve dispositions; they do not declare the final gate clean.

| ID     | Status/severity                                     | Attacker prerequisite                                                    | Asset/boundary               | Evidence/control                                                                                                          | Residual and smallest correction                               |
| ------ | --------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| SF-001 | Contractual residual / High if misdeployed          | Consumer broad-binds without TLS, authn, tenant-binding authz, or rates. | Remote; TB-01..03            | Local default `server.ts:18-19,55-57`; exclusions `README.md:15-24`, `server/README.md:86-87`.                            | Deployment owns ingress; correct only framework claim/bypass.  |
| SF-002 | Contractual residual / Medium                       | Same-host attacker can alter/access IPC directory.                       | IPC; TB-06                   | `adapter-config.ts:33-56`; `signal-transport.ts:592-602`; `transport/README.md:31-45`.                                    | Host isolation external; fix only proven privacy-check bypass. |
| SF-003 | Contractual residual / Medium                       | Generated module/path/root or developer/CI is controlled.                | Node execution; TB-07,08     | `generated-registry-discovery.ts:174-258`; dynamic import executes selected code.                                         | Trusted root required; no speculative sandbox.                 |
| SF-004 | Evidence observation / No advisory                  | Audited lock closure remains current.                                    | Dependencies; TB-09          | Coordinator zero-advisory and 235-signature evidence; lock integrity anchors.                                             | Re-run after dependency change; reviewer verifies freshness.   |
| SF-005 | Evidence observation / Medium availability residual | Exposed caller or trusted handler drives valid work.                     | Availability; TB-01,02,04,05 | Limits `spine-services.ts:925-938,1206-1460`; delivery caps `delivery-loop.ts:195-214`; runtime limit `runtime.ts:47-58`. | App rates/trusted-handler supervision external.                |
| SF-006 | Evidence observation / Low                          | Caller induces failure and reads output.                                 | Sensitive data; TB-10        | Allowlist `signal-intake.ts:58-115`; redaction test `signal-transport.test.ts:584-593`.                                   | Log sink policy external; regression only for framework leak.  |

## Accepted-residual contract

The initial-release contract assigns TLS, authentication, authorization, rate
limits, secrets, host security, production persistence adapters/deployment,
worker supervision, and production retry monitoring to consumers/deployment.
Framework storage, tenant propagation/isolation, and delivery behavior remain
in scope alongside structural validation, resource limits, private IPC
handling, lifecycle cleanup, and diagnostic redaction. A proven bypass is
release-blocking and needs focused behavior regression evidence.

## Review rounds and exit checklist

| Round | Scope                                   | Status                                               |
| ----- | --------------------------------------- | ---------------------------------------------------- |
| 0     | Requirements splitter                   | Accepted: ten TB boundaries and TM-001..TM-012.      |
| 1     | Artifact author                         | Finding Batch 1 corrected; coordinator checks clean. |
| 2     | Dedicated security reviewer, Terra High | Pending; no clean outcome claimed.                   |
| 3     | Style/docs/API/reliability              | Pending after artifacts/fixes stabilize.             |

- [x] Threat model TB-01..TB-10 / TM-001..TM-012.
- [x] Coordinator audit, signature, and registry-script evidence.
- [x] Coordinator generation, generated typecheck, and 19-file security
      regression evidence.
- [x] Reachability categories and accepted-residual contract.
- [x] Generated output checked untracked by author.
- [x] Focused documentation checks after artifact write.
- [ ] Dedicated security review, any focused fix/regression, canonical review
      dispositions, full verification, integration, remote sync, and task closure.
