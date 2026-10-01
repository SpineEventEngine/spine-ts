# Public npm provenance fields

Main made bounded, unauthenticated reads on 2026-09-30 because the independent
API reader's read-only sandbox could not resolve registry.npmjs.org. Both reads
succeeded; no registry state was changed.

- Metadata: https://registry.npmjs.org/@spine-event-engine%2fcore/2.0.0-snapshot.18
- Attestations: https://registry.npmjs.org/-/npm/v1/attestations/@spine-event-engine%2fcore@2.0.0-snapshot.18

Metadata exposes `dist.integrity` as SHA-512 SRI and `dist.attestations.url`.
Its provenance predicate type is `https://slsa.dev/provenance/v1`.
The attestation response contains an `attestations` array with separate npm
publish and SLSA provenance entries. Select SLSA provenance, not the first entry.

For the observed SLSA entry, decode `bundle.dsseEnvelope.payload` as UTF-8 JSON.
The statement has these fields:

- `_type`: `https://in-toto.io/Statement/v1`
- `predicateType`: `https://slsa.dev/provenance/v1`
- `subject[0].name`: `pkg:npm/%40spine-event-engine/core@2.0.0-snapshot.18`
- `subject[0].digest.sha512`: hexadecimal form of the same SHA-512 bytes used in
  metadata's Base64 SRI value.
- `predicate.buildDefinition.buildType`:
  `https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1`
- `predicate.buildDefinition.externalParameters.workflow.repository`:
  `https://github.com/SpineEventEngine/spine-ts`
- `predicate.buildDefinition.externalParameters.workflow.path`:
  `.github/workflows/publish.yml`
- `predicate.buildDefinition.externalParameters.workflow.ref`: `refs/heads/master`
- `predicate.buildDefinition.resolvedDependencies[0].uri`:
  `git+https://github.com/SpineEventEngine/spine-ts@refs/heads/master`
- `predicate.buildDefinition.resolvedDependencies[0].digest.gitCommit`:
  `9e1147298248a8e0b095bf41ecabd8d8dbb2b511`
- `predicate.runDetails.builder.id`:
  `https://github.com/actions/runner/github-hosted`
- `predicate.runDetails.metadata.invocationId`:
  `https://github.com/SpineEventEngine/spine-ts/actions/runs/36731237760/attempts/1`

The independent reader also checks pinned npm's source. This is evidence about
public record structure and identity, not independent cryptographic validation
or evidence that the new branch has published successfully.
