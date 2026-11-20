# Oversized Agent history records

## Status and scope

Deferred by the human on 2026-11-20. This is a separate future task, excluded
from the current Agent delivery and model Commands work. No implementation or
storage strategy is authorized by this record.

## Problem

Each `AgentHistoryEntry` is stored directly; growing history creates more
records. An individual entry can nevertheless exceed a storage
provider's per-entity or per-property size limit.

For example, prepared-request history retains the complete AI Command and its
triggering application Command or Event. When the AI input embeds the source
payload, a roughly 600 KiB payload can appear twice in one history record and
exceed Datastore's entity limit. Large provider requests or responses can also
exceed it individually.

The Datastore history append path currently rejects serialized records above
1,000,000 bytes. This framework-selected threshold is not a complete calculation
of the encoded database entity size, and atomic Agent commits use a separate
history-write path. The implementation does not split oversized records or
store their payloads elsewhere.

## Future assessment

- Define the required behavior for an individual oversized history entry.
- Account for actual provider entity/property and transaction limits, including
  encoding overhead, across all history-write paths.
- Preserve complete history and the required atomic relationship with Agent
  state changes. Do not silently truncate content.
- Evaluate storage approaches and their read costs, interruption behavior, and
  cleanup needs before selecting a design. Payload splitting and external
  payload storage were suggestions, not accepted requirements.

Related work: [Agent model Commands](../agent-model-commands/TASK.md).
