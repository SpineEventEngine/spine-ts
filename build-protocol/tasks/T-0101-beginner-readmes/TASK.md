# T-0101: Beginner-oriented README journeys

Status: In progress
Start: `2026-08-03`
Baseline: `df9234f1`
Branch: `task/T-0101-beginner-readmes`
Worktree: `.worktrees/T-0101-beginner-readmes`

Classification: Standard documentation task. It reviews every repository
README and changes public architecture, transport, startup, and deployment
claims, but it does not change runtime code, public contracts, generated
sources, dependencies, or deployment behavior.

## Objective

Makes human-facing Markdown consistently call the example “Message Board” and
makes repository READMEs teach beginners in a gradual sequence: purpose and
context, the smallest successful start, behavior and architecture, explained
code, and only then operations or deployment.

## Human-Imposed Requirements Ledger

1. Human prose in documentation and Markdown uses “Message Board”, not
   “MessageBoard”. Exact code identifiers, package/path names, and truthful
   quoted output remain unchanged where spelling them with a space would be
   technically false.
2. The Message Board guide moves image-building material to the end under a
   `Deployment` section, with `Build local images` as a subsection.
3. The Deployment section first explains the larger production context and
   topology before image-building commands.
4. Every repository README receives a beginner-usability disposition.
5. Human READMEs explain their subject gradually: what it is, how to start,
   how it works, useful architecture/topology, and explained code samples
   before deployment/image operations where those elements are relevant.
6. The Message Board guide explains native gRPC, browser gRPC-Web/Connect,
   server/UI interaction, query authority, and subscription refresh hints with
   a useful diagram.
7. Preserve the established Spine TS README look and feel: concise prose,
   emoji headings, checklists where useful, code blocks, warnings, links, and
   separate agent references.
8. Do not invent behavior. All commands, snippets, diagrams, protocols,
   topology, package names, paths, and limitations must match current code.
9. Preserve unrelated dirty files in the primary checkout, especially
   `human-review-1-jul.md`, `human-review-22-jul.md`, and the user-owned root
   README edit.
10. Review, verify, commit, push, merge, post-merge verify, push `main`, and
    remove merged task branches/worktrees under the build protocol.

## Scope And Method

- Inventory all authored `*.md` occurrences of `MessageBoard`; change prose,
  headings, and link labels while preserving exact identifiers and historical
  evidence that must remain literal.
- Restructure `examples/message-board/README.md` as the primary application
  journey and add a Mermaid architecture/deployment diagram grounded in current
  server, browser gateway, native gRPC, storage, delivery, and subscription
  behavior.
- Review all 34 repository READMEs. Improve reader-facing root, package,
  example, interop, compatibility, architecture, and maintainer guides only
  where the current sequence assumes context or places operations before
  understanding. Record concrete no-change reasons for narrow fixtures,
  generated-source notes, or already-complete guides.
- Add the durable beginner-journey rule to `build-protocol/CODE_QUALITY.md`.

## Verification And Review

- Selected final profile: `pnpm verify:task --no-tests`, because changes are
  authored Markdown and protocol records only. Deterministic preflight also
  checks formatting, links, documentation audience, Mermaid/code fences,
  prohibited unqualified `MessageBoard` prose, and `git diff --check`.
- Documentation review is required for teaching quality and completeness.
- TypeScript/API review is required if public code snippets or package/API
  claims change.
- Performance/reliability review is required for changed topology, lifecycle,
  subscription, storage, or deployment claims.
- Style/maintainability is N/A unless production code changes.
- Security is N/A because the task changes no trust boundary or security
  behavior; authentication/deployment prose must still remain factual.
- Fresh-reader testing follows review and asks realistic beginner questions
  without work-log context.

## Acceptance Criteria

1. No human-facing authored Markdown uses `MessageBoard` as the product name.
2. The Message Board README follows the requested learning order and places
   Deployment last with Build local images beneath it.
3. Its diagrams and prose explain browser and native gRPC paths, authoritative
   queries, best-effort subscription hints, application/storage ownership, and
   combined versus standalone production topology accurately.
4. All repository READMEs have a durable changed/no-change disposition and
   reader-facing guides are understandable without internal project history.
5. Every added or retained command, link, snippet, and diagram is mechanically
   valid and conceptually reviewed.
6. The reviewed branch is merged, post-merge verified, pushed, and cleaned up.

