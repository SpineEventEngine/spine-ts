# Main preflight findings

These are concrete checks of the in-progress implementation, not final review.
Return confirmed findings to the existing implementer in one batch.

1. Actual npm 11.16.0 rejects the environment currently built by `invokeNpm`.
   Command: `NPM_CONFIG_USERCONFIG=/dev/null NPM_CONFIG_GLOBALCONFIG=/dev/null npm config get registry`.
   Exit 1: `double-loading config "/dev/null" as "global", previously loaded as "user"`.
   Use distinct safe configuration paths and test the real pinned npm startup
   without publishing. Do not introduce a token fallback.

2. Check that the two-attempt limit survives job reruns. The current loop starts
   at zero even when the prior report contains two pre-upload conflicts. A
   missing version must not authorize attempts three and four. Add a focused
   regression test and keep the saved attempt count authoritative.

3. Compare archive package.json's actual version with the expected common version,
   not just the manifest's declared version and checksum. The current inspector
   return does not expose version; matching dependencies is insufficient for
   packages without internal dependencies. Confirm this against final code.

4. Preserve the previous prepare command's interruption cleanup. The earlier
   implementation registered SIGINT/SIGTERM cleanup; the replacement currently
   has only `finally`, which does not execute for default signal termination.
   Keep or replace the corresponding focused behavior checks.

5. Method-size review must cover the new operational scripts too. The cleanup
   checker currently passes despite the long publication coordinator. Follow
   the documented 35-line callable limit and document every new helper; passing
   a checker is not a waiver for an uncovered rule.
