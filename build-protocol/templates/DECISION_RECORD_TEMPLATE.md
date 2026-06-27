# D-XXXX: <Decision Title>

Date: `<YYYY-MM-DD>`
Status: Proposed | Accepted | Superseded
Task: `<TASK-ID or global>`

## Context

Describe the forces, constraints, and protocol or quality requirements that make this decision necessary.

## Decision

State the selected path.

## Alternatives Considered

- `<alternative>`: `<reason accepted or rejected>`

## Security Impact

| Area | Impact |
| --- | --- |
| Dependencies | `<impact or N/A with reason>` |
| Secrets and credentials | `<impact or N/A with reason>` |
| IPC | `<impact or N/A with reason>` |
| Validation | `<impact or N/A with reason>` |
| Tenant boundaries | `<impact or N/A with reason>` |
| `Any`/deserialization | `<impact or N/A with reason>` |
| Logging | `<impact or N/A with reason>` |

Redaction rule: record enough context for auditability, but never commit tokens, credentials, auth headers, secret environment variables, sensitive local paths, or sensitive payloads.

## Consequences

- `<expected consequence>`

## Follow-Up

| Follow-Up | Owner | Linked Task/Decision | Disposition | Next Review Point |
| --- | --- | --- | --- | --- |
| `<follow-up>` | `<owner>` | `<task or decision>` | `<accepted, deferred, N/A, blocked>` | `<review point>` |
