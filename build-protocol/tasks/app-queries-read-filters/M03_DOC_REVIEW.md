# M03 documentation review

Existing documentation_reviewer, app_query_m03_docs, explicitly dispatched
gpt-6-luna / medium. Runtime self-introspection unavailable; no visible profile
mismatch. Reviewer returned read-only findings; main transcribed them.

P3: docs/api/README.md explains Query status details but omits the corresponding
Topic and lifecycle details. Add that malformed Topic uses INVALID_ARGUMENT with
INVALID_TOPIC, unsupported Topic targets use UNSUPPORTED_TOPIC_TARGET, and
malformed Activate/Cancel uses INVALID_SUBSCRIPTION. Declared constraint errors
carry packed ValidationError paths. This is current client-facing M03 behavior.

No contradictions found in changed core validation claims, browser send claims
or Query status descriptions. No source changes or tests run by reviewer.
