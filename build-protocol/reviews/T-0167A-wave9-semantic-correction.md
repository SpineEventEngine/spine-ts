# T-0167A Review Record

Status: Implementation in progress

## Review boundary

Review the removal of TypeScript semantic metadata and interface-based routing
from the T-0167A baseline while preserving exact/default routing, typed durable
targets, replay behavior, and frozen Proto declarations.

## Planned concern dispositions

- **Style/maintainability:** required because the correction deletes a
  cross-package abstraction and must leave one coherent routing path.
- **TypeScript/API:** required because public routing and registry APIs are
  removed.
- **Performance/reliability:** required because route selection, target
  persistence, and replay behavior must remain stable.
- **Documentation/TSDoc:** required for affected public comments and active
  canonical records; product Markdown remains Wave 10 work.
- **Security:** N/A unless implementation changes a trust boundary, logged
  data, authorization, or secret handling. None is planned.

Reviewer assignments will name the existing role plus explicit configured
model/reasoning before dispatch. Runtime metadata will be recorded when the
surface exposes it; otherwise the immutable role profile and limitation will
be recorded.
