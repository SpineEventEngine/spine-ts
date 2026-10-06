**Scoped acceptance:** No actionable style or maintainability findings in the release-gate correction since `084ffa5af`.

The artifact writer reuses the existing deterministic ID helper. Its regression test checks repeatability, 64-hex format, and a changed ID after a version change. The two Proto-tools fixtures import Time through the public `core/time` export with a declared test dependency. The startup, publication, and release-policy tests retain their concrete assertions while using the current release version. The diff adds no checker suppressions or new identity scheme; the generated ID and marker agree.

**Limit:** This review used the recorded clean preflight and focused test evidence plus source inspection. The full release retry and coverage acceptance remain pending.
