# T-0175 Beginner Guide Review

Status: Implementation in progress; review not started

The task Human-Imposed Requirements Ledger is binding.

## Assignment profiles

- Implementation: existing `implementer`, explicit `gpt-5.6-terra` / medium.
- Documentation: existing immutable `documentation_reviewer`, configured
  `gpt-5.6-luna` / medium.
- TypeScript/API documentation: existing `typescript_api_docs_reviewer`,
  explicit `gpt-5.6-terra` / high.
- Performance/reliability: existing `performance_reliability_reviewer`,
  explicit `gpt-5.6-terra` / high.
- Style/maintainability: N/A for a guide-and-records-only change.
- Security: N/A unless a trust-boundary claim changes; canonical auth/secret
  facts remain part of documentation review.

The surface does not expose separate runtime-profile metadata. The immutable
configured roles and explicit profiles are accepted unless a mismatch or
fallback is reported.

## Pending evidence

- Approved ten-section structure and primary-handoff map.
- Default strict snippets, API/audience, links, retired-routing/current-scope
  scans, natural-prose checks, formatting, licensing, diff, and task profile.
- Complete specialist review wave and one consolidated correction batch.
