# T-0086 Message Board Plan

## Outcome

The current Chat example becomes Message Board everywhere in active source,
package coordinates, generated code, startup tooling, and beginner-facing
documentation. A signed-in visitor supplies a display username and message.
The server validates both fields from authored Proto rules; the browser unpacks
the returned `ValidationError` and renders those exact messages beside the
corresponding controls. Messages render oldest first, newest last, with a
human-readable age in a polished accessible Shadcn interface.

Historical task/review/work-log records remain unchanged unless an active path
inside them would break repository tooling.

## Decisions

1. Use `examples/message-board` for the example family,
   `@spine-event-engine/example-message-board-{model,app,web}` for packages,
   `spine.examples.messageboard` for Proto, and
   `type.spine.examples.messageboard` for type URLs.
2. Keep the trusted actor identifier in the command and add a separate
   user-entered `username` string. A display name is not an authentication
   identity.
3. Declare distinct username and message missing-value messages with
   `(required) = true` and `(if_missing).error_msg` in `PostMessage`. Propagate
   the accepted values into the event, aggregate state, and Projection.
4. Do not duplicate required-field policy in the browser. Submit empty values,
   unpack the server's packed `ValidationError`, map violations by field path,
   and show their formatted response messages. Transport and non-validation
   failures retain a general retry notice.
5. Query the Projection with ascending `posted_at` order. Create timestamps with
   millisecond precision and apply a deterministic client-side tie break only
   for equal timestamps so rendering cannot reorder rows unpredictably.
6. Format relative ages with `Intl.RelativeTimeFormat`: under one minute is
   `just now`, then rounded-down minutes, hours, and days. Use one cleaned-up
   periodic clock for the page, not a timer per message.
7. Add only the owned Shadcn components the page uses, together with the normal
   `components.json`, Tailwind theme, and `cn` utility. Do not introduce a
   generalized design system or application startup seams.

## Dependency-ordered slices

### 1. Contract and domain behavior

- First add failing source/generated/runtime tests for the new names, Proto
  validation messages, username propagation, and ascending query order.
- Rename the example family and active references.
- Change authored Proto, regenerate deterministically, and update the aggregate,
  Projection, model registry, local session, app tests, and query/topic builder.
- Preserve full Proto documentation with blank lines between documented fields.

### 2. Browser behavior

- First add failing component tests for username input, textarea semantics,
  server-derived field errors, submission retry, ordered rows, and relative
  time boundaries.
- Add a small response decoder and relative-time formatter with focused unit
  tests. Keep semantically related helpers in documented types/objects.
- Implement the React page with Shadcn Button, Card, Input, Label/Field,
  Textarea, and only other components visibly needed by the final composition.
- Provide associated labels, `aria-invalid`, described field errors, live
  status/error announcements, keyboard operation, visible focus, semantic
  message/time markup, mobile layout, and reduced-motion behavior.

### 3. Startup, docs, and repository integration

- Update the single-command server and web startup contracts and every active
  beginner README/reference link affected by the rename.
- Update workspace manifests, imports, aliases, scripts, quality checks,
  package payload tests, generated-clean rules, release metadata, and lockfile.
- Remove obsolete Chat-named active files and prove no broken active reference
  remains.

## Acceptance tests

- Empty username and message submitted together produce two Proto-authored
  server violations and the UI displays the returned messages at their fields.
- Correcting one field clears/replaces only the next server response state;
  successful submission clears both controls and refreshes the board.
- A signed-in actor can choose a display username without changing the trusted
  actor context.
- At least three deliberately shuffled Projection rows render by creation time,
  oldest to newest, and a newly posted message appears last.
- Relative time covers just-now, singular/plural minutes, hours, and days with
  an injected clock.
- Browser acceptance covers narrow and wide viewports, keyboard posting,
  server-derived validation, and the running standalone server/web commands.
- Accessibility audit has no serious violations; bundle inspection records the
  production output and avoids whole-library icon/component imports.

## Verification and review

Run focused generated/model/app/web/tooling tests and checks before review.
Review style/maintainability, documentation, TypeScript/API, and
performance/reliability in one wave. Run `pnpm verify:release` once after all
findings are resolved. Commit and immediately push every feature checkpoint;
merge only after the final gate, verify the merge on `main`, and push `main`.
