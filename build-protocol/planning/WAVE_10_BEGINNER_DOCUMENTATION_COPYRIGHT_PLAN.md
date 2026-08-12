# Wave 10 Beginner Documentation And Copyright Plan

Status: Draft; requirements split pending

## Outcome

Wave 10 will give a beginner one gradual path from a domain idea to a tested,
observable, deployable Spine TS application. Concise README files will orient
the reader, the user guide will teach complete workflows, and dense reference
documents will hold exhaustive contracts and limits. The repository will also
carry one consistent Apache 2.0 licensing declaration and the exact approved
CodeMatters header on every eligible authored TypeScript, TSX, and Proto file.

Multiple-Gateway behavior is deferred to a later wave. Cloud Run remains
outside the initial offering.

## Approved Documentation Layers

1. **README — introduction.** Explain what a package or example is, when a
   beginner needs it, the shortest successful path, and where to continue.
2. **USER_GUIDE — guided application journey.** Explain concepts gradually and
   use working examples to take a reader from domain discovery through
   deployment.
3. **REFERENCE/TypeDoc/focused guides — exhaustive detail.** Hold complete API,
   provider, limits, operational, deployment, and compatibility contracts.

## Approved Beginner Guide Structure

1. Discover the domain with EventStorming and divide it into Bounded Contexts.
2. Create a Node.js/TypeScript project and add Spine TS.
3. Describe IDs, Commands, Events, Entity states, columns, and rejections in
   Proto, then generate TypeScript.
4. Implement Aggregates, Process Managers, Projections, handlers, exact/default
   routing, `@Where`, and rejection behavior.
5. Send Commands; read, query, and subscribe to Entity state; reconnect and
   design idempotent client behavior.
6. Choose in-memory, MySQL, or Datastore persistence; understand tenancy,
   physical layouts, typed mappings, and migrations.
7. Test domain behavior, handlers, storage, clients, and application flows.
8. Configure application/framework logging and operational observability.
9. Package and deploy combined or distributed applications on the supported
   GKE/GCE paths.
10. Continue with Message Board, Distributed Message Board, To-Do, Orders, and
    Projects examples.

## Approved Copyright Header

```text
/*
 * Copyright 2026, CodeMatters. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License
 * is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions and limitations under
 * the License.
 */
```

The exact eligibility inventory, exclusion inventory, future-year comparison
rule, reader-document inventory, task dependency graph, and acceptance matrix
will be completed after the read-only requirements split.
