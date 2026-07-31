# T-0086: MessageBoard example

Status: Complete
Start: `2026-07-31`
Baseline: `b0ad668163f598f487d71d380e2477bb8575f419`
Branch: `task/T-0086-message-board`
Worktree: `.worktrees/T-0086-message-board`

Classification: High-risk. The task changes authored Protobuf contracts,
server-derived validation behavior, Projection ordering, and the public browser
example.

## Objective

Renames the Chat example and product vocabulary to MessageBoard. Adds required
username and message inputs whose validation rules and messages originate in
Proto and whose server validation failures are rendered by the UI. Orders
messages from oldest to newest, shows approximate age, and replaces the current
page with a polished, accessible Shadcn-style React interface.

## Human-Imposed Requirements Ledger

1. Rename the Chat example to `MessageBoard`.
2. Add a username field.
3. Username and message are mandatory, with respective validation messages.
4. Validation rules and messages are declared in Proto.
5. UI validation failures are derived from the server response, not duplicated
   client-side policy.
6. The message control is a textarea.
7. Messages appear in creation order; the newest message is last.
8. Each message displays approximate relative time such as `just now`,
   `1 minute ago`, `3 hours ago`, or `2 days ago`.
9. Use Shadcn components and produce a polished modern UI.
10. Preserve the repository's TSDoc, Proto documentation, naming, example
    package/type-URL, testing, accessibility, and documentation rules.
11. Commit and push every feature-branch commit immediately; merge only after
    review and verification.
12. Do not touch either protected `human-review` file or build Spine JVM.

## Planning Dispatch

- Existing role: `requirements_splitter`.
- Scope: determine the smallest dependency-ordered Proto/domain/UI slices,
  including the exact server validation response path and example rename
  surface.
- Expected model: `gpt-5.6-sol`.
- Expected reasoning: high.
- Both fields must be explicit. Runtime self-metadata must be recorded when
  exposed; otherwise the immutable role profile and limitation are evidence.

Disposition: the configured role/profile was immutable and accepted. Runtime
self-metadata was not exposed. The splitter traced the validation response,
query-ordering, rename, package, and tooling surfaces, but did not return its
final synthesis after two bounded stop requests. The orchestrator stopped the
overlong exploration and completed the plan from the traced evidence in
`build-protocol/planning/T-0086_MESSAGE_BOARD_PLAN.md`.

## Implementation Dispatch

- Existing role: `implementer`.
- Ownership: the complete T-0086 worktree, as the single production-code
  writer, including authored/generated Proto, the example family, affected
  current documentation/tooling, tests, and package metadata.
- Expected model: `gpt-5.6-terra`.
- Expected reasoning: medium.
- Both fields must be explicit. The owner must not spawn children, commit,
  push, build Spine JVM, or touch protected files.

## Skill Applicability

- Inventory sources: current session inventory; bounded
  `/Users/armiol/.agents/skills` enumeration; repository expected-skill
  manifest; `/Users/armiol/.agents/.skill-lock.json`.
- Selected: `using-git-worktrees`, `implement`,
  `test-driven-development`, `requesting-code-review`,
  `verification-before-completion`, `webapp-testing`, `accessibility`, and
  `performance`.
- The worktree skill established this isolated branch. Recent verified `main`
  evidence replaces a redundant full baseline under the repository protocol.
- Architecture and API-design skills are not selected: the required public
  behavior is bounded to the existing example contracts and framework
  validation path; the splitter owns any demonstrated architectural question.

## Verification Profile

- Selected final profile: `verify:release`, because authored Proto contracts,
  generated code, runtime/example tests, dependencies, and the browser bundle
  change.
- Cheap preflight: focused model/app/web tests, generated and tooling
  typechecks, deterministic Proto/docs checks, changed-file lint/format, browser
  acceptance, accessibility audit, bundle inspection, and `git diff --check`.

## Integration

- Reviewed task endpoint: `5c67ebfd13d6c346b8507b96a57422ba54872822`.
- Integration merge: `18090c2faef565533914f0e9d176a4814372b4aa`.
- The merged tree and verified task tree share exact tree hash
  `a78586164a509c7cfed4acd708734c927ae94b77`.
- Post-merge generation/build and real Playwright acceptance pass in Chromium,
  Firefox, and WebKit.
- The feature branch and integration merge were pushed to `origin`; this
  closure record is pushed in its containing `main` commit.
