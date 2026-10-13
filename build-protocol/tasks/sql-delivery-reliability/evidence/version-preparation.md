# Package/version preparation

Read-only snapshot for the SQL Delivery reliability feature branch, 2026-10-14. The worktree's root and all 30 other workspace manifests currently say `2.0.0-snapshot.22`.

## Version inventory

`pnpm-workspace.yaml` (lines 1–4) declares `packages/*`, `packages/*/test-fixtures`, `examples/*`, and `examples/*/*`. The exact 31 paths are enumerated by `scripts/package-metadata.test.mjs:249–288`: root `package.json`; all 19 public `packages/*/package.json`; private `packages/core/test-fixtures/package.json`, `packages/server-blackbox-tests/package.json`, `packages/server/test-fixtures/package.json`, and `packages/testing/test-fixtures/package.json`; and seven example manifests (`distributed-message-board`, `message-board/app`, `message-board/model`, `message-board/web`, `orders`, `projects`, `todo`). All 31 top-level versions belong in the version-only commit.

There are 55 hardcoded internal `2.0.0-snapshot.22` dependency references in 20 manifests; other local references use `workspace:*`. Hardcoded-pin files: `examples/message-board/{app,model}/package.json`, `examples/{orders,projects,todo}/package.json`, `packages/{auth,client-node,client-web,core,delivery-client,delivery-server,proto-tools,server,storage-datastore,storage,transport}/package.json`, `packages/core/test-fixtures/package.json`, `packages/server-blackbox-tests/package.json`, `packages/server/test-fixtures/package.json`, and `packages/testing/test-fixtures/package.json`.

The release-policy inventory in `scripts/release-policy.mjs:10–40` covers 27 manifests: root, 19 public packages, and seven examples. It intentionally excludes the four private fixture manifests above. `scripts/package-metadata.test.mjs` checks all workspace versions and local dependency pins, including those four. Use both checks when validating the eventual version commit.

## Registry snapshot and candidate

Queried the official npm registry on 2026-10-14 using `npm view <package> versions --json --registry=https://registry.npmjs.org/` for every public package in `packages/*` whose manifest is not private. All 19 latest published versions were `2.0.0-snapshot.22`; none listed `2.0.0-snapshot.23`. The current published version advances independently of this source checkout, so `2.0.0-snapshot.23` is only a provisional unused candidate and needs a fresh exact-version check immediately before the version-only commit. This check does not reserve the version.

Repeatable registry check (read-only):

```sh
node --input-type=module -e 'import { readdirSync, readFileSync } from "node:fs"; import { join } from "node:path"; import { spawnSync } from "node:child_process"; const names = readdirSync("packages", {withFileTypes:true}).filter(d=>d.isDirectory()).map(d=>JSON.parse(readFileSync(join("packages",d.name,"package.json"),"utf8"))).filter(p=>p.private!==true).map(p=>p.name).sort(); const candidate="2.0.0-snapshot.23"; for (const name of names) { const r=spawnSync("npm",["view",name,"versions","--json","--registry=https://registry.npmjs.org/"],{encoding:"utf8"}); if(r.status!==0) throw Error(name+": "+r.stderr); const versions=JSON.parse(r.stdout); console.log(JSON.stringify({name,latest:versions.at(-1),candidatePublished:versions.includes(candidate)})); }'
```

## Validation and commit boundaries

- `pnpm exec vitest run scripts/package-metadata.test.mjs` checks root/workspace version agreement, all workspace-local pins, and the expected workspace list.
- `pnpm check:release-readiness` checks the fixed 27-path release policy plus additional release readiness rules. It is broader than a metadata-only check; it was not run for this read-only preparation.
- Before changing versions, inventory manifests and pins with: `rg --files -g package.json | sort`; inspect each `version` and local dependency group (`dependencies`, `devDependencies`, `optionalDependencies`, `peerDependencies`). `pnpm-workspace.yaml` and the explicit test list above are the workspace inventory sources.
- The version-only commit must change only each of the 31 top-level `version` fields and use exact message `Bump version -> <version>`. Internal dependency pin updates and `pnpm-lock.yaml` belong in a separate commit, per `build-protocol/BUILD_PROTOCOL.md:387–390`. The existing lockfile is already dirty in this worktree; no lockfile changes were made as part of this preparation.

No package install, build, validation script, or publication was run. Registry checks only read published metadata. The candidate and freshness assessment must be repeated at final version preparation.

## Dispatch metadata

This review used the existing `documentation_reviewer` role, explicitly dispatched as `gpt-6-luna` with `medium` reasoning. The execution surface does not expose actual per-turn runtime metadata, so the immutable configured role/profile is recorded; there is no visible mismatch or inherited-profile fallback evidence.
