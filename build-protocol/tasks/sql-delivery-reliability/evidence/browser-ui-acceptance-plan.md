# Message Board browser acceptance plan

**Assignment:** read-only UI acceptance preparation; orchestrator-dispatched function configured `gpt-6-luna` / `medium`. Runtime self-introspection is unavailable. No application was launched and no UI acceptance was performed.

## User journey and observable state

The UI has one fixed `general` board and supports posting a new message; it has no edit-existing-message control. Posting is the write journey, and the `BoardViewProjection.onMessagePosted` handler creates the read row from the `MessagePosted` event. Use a unique username and text per run.

1. Navigate to `/`; wait with a bounded locator assertion for heading **Message Board**, status **Updating live**, and the form controls. Do not wait for `networkidle`: board subscriptions are long-lived.
2. Optionally confirm server validation by submitting empty fields with **Post message**. Expect alerts **Enter a username.** and **Enter a message.**, focus on the **Username** textbox, and `aria-invalid="true"`. Then fill valid values.
3. Use accessible selectors as candidates, confirmed against rendered DOM: `get_by_role("textbox", name="Username")`, `get_by_role("textbox", name="Message")`, `get_by_role("button", name="Post message")`, `get_by_role("status")`, and `get_by_role("list", name="Messages")`. After posting, assert the matching message article contains the unique username and message and appears as a list item; the submit button returns to **Post message**. These checks demonstrate the command was accepted and its projected row became visible.

## Live cross-process update

Open two separate Playwright browser contexts (independent cookie/storage contexts), each with a page at `/`. Wait for **Updating live** in both and record each page URL. Post a unique message from context B. Assert context A's existing Messages list gains that username/text without `goto`, reload, or URL change; also assert the row in B and that both statuses remain **Updating live**. Repeat with A posting and B observing to test both directions. Use a bounded visible-row assertion (for example, 15 seconds) because the subscription is live; inspect `page.content()`/accessibility snapshot before adjusting selectors.

## Errors to capture

Treat uncaught browser console errors, failed command/query/subscription requests, HTTP 404/401/5xx, a **No live updates** status, rejected posts, or a row missing from either existing page as failures. During successful posting, expect the app's informational “sending” and “accepted” logs. An intentional empty-form validation check may log the app's expected post-rejected warning; do not classify that deliberate validation response as a transport failure. Capture browser console and failed requests with each test's log.

## Required launch modes

- **Local React single-process exception:** run `examples/message-board/scripts/start-local-single-process.sh`, open `http://127.0.0.1:5173`, and exercise the post/projection journey. This mode intentionally uses in-memory storage and local Delivery; do not require multiple application processes or shared Delivery.
- **Shared Delivery multi-process:** run the supported local multi-process launcher with **8 application processes and 8 Delivery shards**, then repeat the journey and two-context live-update assertions against its UI origin. The launcher currently exposes `MESSAGE_BOARD_PROCESS_COUNT` but hard-codes `DELIVERY_SHARD_COUNT=2` and host ports 8484, 8081, 8091, 8090, and 5173. The source plan requires coherent supported 8/8 and isolated port settings before this run; use the documented settings after implementation, and verify startup logs/config evidence report 8 processes and 8 shards. Keep the UI's Gateway URL, Gateway backend URL, application listener, Delivery, Datastore emulator, and browser origin aligned. Do not describe the current 2-shard launcher as an 8/8 run.

After each mode, stop only the launcher started for that run and retain the Playwright logs/screenshots under this task's worktree evidence directory. Passing this browser journey demonstrates the user-visible write, projection, and live cross-process update; it does not test Delivery restart durability or prove a delivery deadline.

Parent execution constraint: the fixed URLs above describe the current source,
not authorized port allocations. Both local launch modes must use supported
isolated port/origin/backend settings before acceptance. Inspect existing
listeners and allocate task-specific ports; never displace another process.
Use the final configured UI URL in the browser script and evidence.
