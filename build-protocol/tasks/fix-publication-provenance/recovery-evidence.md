# Local npm recovery evidence

The implementer inspected npm CLI 11.16.0, libnpmpublish 11.2.0,
sigstore 4.1.1 and @sigstore/sign 4.1.1 on Node 24.18.0.

`libnpmpublish/lib/publish.js` awaits provenance generation before its registry
PUT. A provenance-generation failure therefore precedes the package upload.
This is source-order evidence, not a full CLI network trace.

`scripts/npm-rekor-recovery.test.mjs` uses the installed real Sigstore signer,
Rekor client and npm error formatter with a local HTTP fixture. The fixture
accepts the first entry but drops its response, then rejects the repeated entry
with HTTP 409. The real client raises `TLOG_CREATE_ENTRY_ERROR`. A fresh signer
produces a different key and proposal, which the fixture accepts. Three POSTs,
two distinct bodies and no GET are observed. No production service is contacted.

npm's JSON formatter preserves this exact combination:

- code: `TLOG_CREATE_ENTRY_ERROR`
- summary: `error creating tlog entry - (409) an equivalent entry already exists`
- detail: `(409) an equivalent entry already exists`

The nested HTTP status is not separately exposed by the CLI. The production
classifier must require the complete pinned-version combination and reject
unknown or changed output. This is deliberately narrower than matching error
fragments, generic TLOG errors or any HTTP 409. If npm changes its output, the
safe result is no retry. No in-process alternative publisher is introduced.

The focused test passed three times; the final run had one pass and no failures
in about 273 ms. `node --check` also passed. This establishes the local failure
and fresh-signing mechanism, not full OIDC/Fulcio/bundle verification, live Rekor
availability, or the original transport failure in the supplied GitHub run.

Existing implementer session `01a0f345-089a-7431-b87b-94ee1adb86a6` used explicit
gpt-6-sol/medium, standard tier and disabled memories. The CLI exposes dispatch
configuration, not per-response runtime model metadata. No fallback was reported.
The initial gate was accepted with the above limits; implementation continues
in the same context. Its CLI final-message output replaced the longer first
report, so this record preserves the reviewed evidence separately.

## Correction from the supplied GitHub log

Main re-read `0_publish.txt` from `logs_99479141341.zip`. Lines 1472, 1476 and
1524 contain the longer real message:

`error creating tlog entry - (409) an equivalent entry already exists in the transparency log with UUID 108e9186e8c5677a245de144eb51ce7c25da7fd499317cef7acfecf9a480e3b2d7dc97903b374234`

The first fixture's shortened text was insufficient: exact matching against it
would never recover the supplied failure. The implementer was interrupted to
correct this before further production work. Reproduce the complete logged
message through the real formatter; accept only its fixed text plus the bounded
hexadecimal record ID, with identical IDs in summary and detail. Generic errors
and extra text remain rejected. Do not describe the first two passing classifier
tests as proving recovery for the actual log.
