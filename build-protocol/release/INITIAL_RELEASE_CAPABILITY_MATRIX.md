# Initial Release Capability Matrix

Status: In progress

Task: T-0038 Accepted Capability Audit

Baseline: `75340852`

## Purpose

Trace every active initial-release requirement to implementation, tests, and
current documentation, or route the requirement to an explicit accepted
classification without silently weakening the contract.

## Classifications

- `IMPLEMENTED`: current production behavior has representative test and
  documentation evidence.
- `DOCUMENTED_EXCLUSION`: active governing sources explicitly exclude the
  behavior from the initial release.
- `STALE_DOC_STATUS`: implementation and active contract disagree with current
  documentation/status; T-0039 owns reconciliation.
- `EXAMPLE_GAP`: framework behavior exists but the required example evidence is
  absent or inaccurate; T-0040 owns closure.
- `SECURITY_GATE`: final security evidence or remediation belongs to T-0041.
- `FRAMEWORK_DEFECT`: mandatory framework behavior is absent or contradicted;
  create the smallest numbered T-0038 child before closing this audit.

## Evidence Rules

- Cite concrete repository paths and named tests/checks.
- Treat superseded historical text as historical unless an active governing
  source or current record claims it.
- Do not infer runtime guarantees from TypeScript declarations alone.
- Do not classify accepted future policy as a missing initial-release feature.

## Source Inventory

| Governing source                         | Active requirement groups | Audit status |
| ---------------------------------------- | ------------------------- | ------------ |
| `build-protocol/TECHNICAL_SPEC.md`       | Pending inventory         | Pending      |
| `build-protocol/PROTOBUF_CONTRACT.md`    | Pending inventory         | Pending      |
| `build-protocol/DEVELOPER_API.md`        | Pending inventory         | Pending      |
| `build-protocol/RUNTIME_ARCHITECTURE.md` | Pending inventory         | Pending      |
| `build-protocol/TODO_EXAMPLE_SPEC.md`    | Pending inventory         | Pending      |
| `build-protocol/CODE_QUALITY.md`         | Pending inventory         | Pending      |

## Capability Traceability

Pending author audit.

## Public Surface And Compatibility

Pending package-root, TypeDoc/export, wire-shape, and type-URL audit.

## End-User API Prohibitions

Pending example and guide snippet scan.

## Accepted Exclusions

Pending active exclusion inventory.

## Routed Gaps

Pending classification.
