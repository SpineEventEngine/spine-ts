# M04 documentation review

Existing documentation_reviewer app_query_m03_docs, explicitly configured
gpt-6-luna / medium. Runtime metadata unavailable; no visible mismatch. Main
transcribed read-only result. Base 54520ee63, frozen M04 current docs.

P3: docs/api/README.md describes unknown/expired Activate and duplicate-active
behavior, but omits that cancelling a well-formed unknown subscription remains
OK. Add the preserved idempotent cancellation rule next to activation behavior.

Fresh-ID recovery, Entity resynchronization, Event gap notices and terminal
error distinctions match implementation and tests. No other finding.

Main confirmed the API guide now explicitly preserves idempotent OK cancellation
for well-formed unknown/already removed subscriptions. Finding resolved.
