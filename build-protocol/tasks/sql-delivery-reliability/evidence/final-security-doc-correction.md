# FS-01 API guide correction

`docs/api/README.md` now states that the built-in subscription registry has no global retained-definition quota, active definitions have no framework TTL, and application or ingress admission must bound acceptable use. It retains the distinct `subscriptionLimit` unknown-ID cancellation concurrency limit and per-stream `queueLimit`.

Verification: `pnpm exec prettier --check docs/api/README.md` passed; `git diff --check -- docs/api/README.md` passed; a focused `rg` confirmed that the stale 1–100 registry-capacity claim is absent from the API guide. This is a documentation correction only; no build was run.
