# Static imports for transitive metadata

Decision: keep discovery in the existing generation procedure and add a
small generated JavaScript adapter with declarations. Render the adapter once
for the source bootstrap location and once for its actual TypeScript output
location. Publish both through existing generation transactions. The existing
build cleanup must restore the runtime adapter before TypeScript compilation.
No runtime resolver, package-manager mutation, or new application configuration
is needed.

This resolves the demonstrated blocker under the normal build invariant:
install dependencies, generate against that installation, compile or bundle,
then deploy the resulting application and its dependency closure. A different
dependency installation requires ordinary regeneration. This decision does not
promise that an already-generated application can be reinstalled into an
arbitrarily different dependency topology without rebuilding.

## Why an adapter is needed

A metadata participant may be installed only below a nonparticipating package.
Its package name then cannot be resolved from the application, even though
build-time discovery finds it. A static adapter imports the actual public
metadata export selected from that installed dependency. The source bootstrap
and compiled bootstrap need separately calculated relative paths.

## Generated artifact contract

The bootstrap keeps one location-independent internal import:

```ts
import { dependencyMetadata0 } from "./spine-dependencies.js";
```

It continues importing local metadata and registering each description with
its package label. The adapter only re-exports passive metadata values; it does
not register, instantiate, or activate anything. One adapter is sufficient for
all discovered participants; no per-package proxy tree is necessary.

For an application with `generated/` and `dist/generated/`, the source adapter
contains a static re-export such as:

```js
export { spineMetadata as dependencyMetadata0 } from "../node_modules/bridge/node_modules/participant/dist/generated/spine-metadata.js";
```

The runtime adapter contains the independently calculated equivalent:

```js
export { spineMetadata as dependencyMetadata0 } from "../../node_modules/bridge/node_modules/participant/dist/generated/spine-metadata.js";
```

These are illustrative paths. Select the real runtime target of the
participant's `./spine` export from the resolved dependency edge. Never assume
that target is `dist/generated/spine-metadata.js`, construct a bare
`bridge/node_modules/...` subpath, or assume a pnpm package is physically beneath
its requesting package. Deduplicate using canonical package identity, while
calculating import paths to actual selected files. Preserve exact constructor
identity with normal application imports; do not copy dependency modules.

The filesystem imports intentionally bypass bare-specifier lookup _after_
build-time resolution has selected a public export. They must never select an
unexported file as a fallback. Package exports constrain package specifiers;
they do not prevent importing a resolved filesystem path. Conditional export
selection must match the application ESM target, including ordered/nested
conditions where supported. A require-condition resolver is not automatically
an ESM resolver. Reject an unsupported or ambiguous export shape explicitly
instead of silently taking its `default` branch. See the official
[Node package documentation](https://nodejs.org/api/packages.html#package-entry-points).

Emit `spine-dependencies.d.ts` beside the source adapter. Its bindings retain the
types of the selected published metadata declarations. For example, a binding
can use `typeof import("../node_modules/.../types/spine-metadata.js").spineMetadata`,
where TypeScript resolves the corresponding `.d.ts`. Resolve the types export
independently; it need not be adjacent to the runtime JS. This is normal
declaration consumption, not dependency source reanalysis. Do not replace these
types with `any`, `unknown`, an invented ambient package, or `@ts-ignore`.
[TypeScript documents this extension substitution](https://www.typescriptlang.org/docs/handbook/modules/reference.html#file-extension-substitution).

TypeScript checks the generated bootstrap against the source adapter declaration
and preserves its `./spine-dependencies.js` import when emitting. TypeScript does
not produce or rebase the generated JS adapter; generation/build machinery does.
Emit a separately rebased declaration beside the runtime adapter as well, so
the complete internal module is inspectable from installed output. Respect
declaration-file module format, a separate `declarationDir`, and the bootstrap's
actual emitted module format; do not infer paths by inserting `dist/`. Bootstrap
declarations should expose no dependency implementation details merely because
the bootstrap imports metadata internally.

The added output is two adapter pairs and one small generated artifact record.
When source and runtime destinations coincide, publish one pair. Keep these
artifacts internal, ignored, and covered by generated-source provenance checks.
No new public package export or client model import is required.

## Publication, freshness, and diagnostics

Stage content using its eventual published location, never a temporary staging
directory. Runtime adapter targets are auxiliary files in the existing atomic
publication; do not replace the entire application `dist` directory during
generation. Constrain writes to validated generated/output destinations and
retain existing symlink/output-safety checks. A generated payload record is
input to a confined artifact copier, not an arbitrary write manifest.

Build cleanup can restore only the recorded runtime pairs, never blanket-copy
the source adapter: the two variants deliberately have different paths. Extend
both the repository clean build and affected example cleanup scripts. An
external build that deletes generator-produced runtime artifacts must run
ordinary generation after cleanup or use the same integrated restoration step.
Plain tsc alone cannot recreate non-TypeScript generated assets.

Include dependency edges, resolved participant identities and selected exports,
their relevant content/provenance, and effective compiler output settings in
freshness/reuse decisions. Relative deployment coordinates must not retain
build-machine absolute paths. Normal regeneration after installation changes
re-resolves the graph; an existing build restoration step encountering stale
inputs should report that ordinary generation is required. Do not add runtime
filesystem checks or pretend TypeScript incremental state tracks this graph.

Diagnostics should name the application, requesting dependency path,
participant/version, selected `./spine` target, and missing or conflicting
artifact. Cover missing JS/types, declaration/runtime binding mismatch,
unsupported condition selection, stale generation, multiple incompatible
installations, and existing unusable initialization-cycle checks. Do not add
arbitrary graph/file caps while resolving this seam.

Required focused negative tests: generation does not execute dependency
modules; a missing declaration is not replaced by an untyped import; a changed
export or dependency layout invalidates reuse; runtime publication failure
leaves no mixed generation; the normal clean step cannot silently discard the
adapter; a failed bundle cannot be reported as successful compiled deployment.
Include custom/inherited output settings and separate declaration output, not
only the repository's default `dist/generated` fixture.

## Portability boundary and exclusions

Relative adapters survive relocation of the entire resolved dependency closure
with its internal layout preserved. pnpm workspace links or external stores
must be included in that closure or replaced by an ordinary installed/deployed
tree before final application generation. Merely copying a workspace app's
`dist` while leaving referenced packages behind is not a portable deployment.
No new package layout is imposed; generation consumes the layout actually used.

Published dependency packages continue shipping reusable local metadata through
`/spine`; consumers generate their own bootstrap against their installation.
Packing those dependencies and installing them elsewhere before generating the
consumer is required proof. Packing a complete application, reinstalling its
dependencies differently, and running an old bootstrap without regeneration is
a different guarantee and is not claimed here.

For that stronger guarantee, the exact conflict is static path binding versus
an installation-dependent nested package hidden behind a nonparticipant's
exports. Resolving it would require a runtime resolution mechanism, a published
bridge export, controlled dependency bundling/layout, or regeneration at the
new installation. The approved existing generation path supplies the last
option, so no new product decision is needed for M06.

Bundling resolves the generated static edges at build time and packages their
code. The bundle must include the metadata/handler closure consistently;
externalizing only part of it may split constructor identity. This decision
does not promise arbitrary bundler externalization policies. Ordinary runtime
module loading still occurs for unbundled imports; that is distinct from
forbidden runtime metadata discovery or scanning.

Exclude package manifest rewriting, dependency hoisting/aliases, installation
mutation, dependency code copying, runtime node:module/fs imports, loader hooks,
new registry-root APIs, and broad generation redesign.
