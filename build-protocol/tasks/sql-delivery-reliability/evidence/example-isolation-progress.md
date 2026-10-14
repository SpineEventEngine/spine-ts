# Example isolation progress

The Orders and Projects local teaching loads each ran with ten users after the
workspace composite build. Both reported zero failed users, ten successful
Command acknowledgements, ten visible queries, and ten domain subscription
deliveries. These runs are local in-memory controls, not multi-process evidence.

The distributed Message Board Compose source previously used shared `:local`
image tags, a fixed browser origin, an externally bound default Gateway port,
and an unused subscription registry setting. A focused topology regression was
red before correction, then green after all three images selected
`MESSAGE_BOARD_IMAGE_TAG`, Gateway bound to loopback on `GATEWAY_PORT`, and
`MESSAGE_BOARD_WEB_PORT` selected the browser origin. The obsolete setting was
removed. `docker compose -p sqlrel-distributed-check ... config --format json`
with distinct task ports and image tag resolved successfully; no containers
were started by that configuration check. Local Message Board launchers now
pass Vite `--strictPort`, keeping the UI origin consistent with configured
ports.

The task-local `browser-ui-acceptance.py` is prepared for the live UI run. It
uses two independent Chromium browser contexts, posts two distinct domain
messages, checks both contexts receive both projected rows without reload, and
records browser errors, screenshots, and a JSON result. Its syntax check passed;
it has not yet run against an application.

The task-local `message-board-burst.mjs` is prepared for a 32-post concurrent
public Node-client run against an eight-process/eight-shard Coordinator. It
creates generated `PostMessage` values with real Message/Board/User identifiers,
requires all 32 acknowledgements, and polls the generated BoardMessageView
query until every run-specific Message ID is visible. Syntax, ESLint and
formatting were checked; no live burst was run while framework dist was
reserved.

Focused example launcher and topology tests: 13/13 passed. Touched JavaScript
ESLint, Prettier, and `git diff --check` passed. Actual distributed Compose,
local Message Board multi-process 8/8, Todo, and browser UI execution remain
pending the current transport-grid dist reservation.

After formatting the distributed topology files, the same 13 focused tests
passed again. The distributed README now shows one task-selectable image tag,
Compose project, Gateway port, and UI port in a single runnable launch sequence.

## Review corrections

The accepted example review found five bounded test and launcher gaps. The
Projects regression now observes the first TaskCreated update at the Project
key before posting the second. The port-zero test accepts any valid selected
TCP port and always closes its child. The burst helper gives post/query work a
45-second absolute budget, uses caller cancellation, separately bounds client
close, records each generated Message ID with its public outcome, and checks
the observed run-specific row multiset for duplicates before deriving the row
count. The public `post` outcome exposes no Command/Ack ID, so this helper
does not claim a Command-ID join or handler-entry count.

Both local launchers now invoke the compiled app and Vite with direct Node
processes rather than a `pnpm` wrapper, so their recorded PIDs are the
listeners. The single launcher bounds TERM/KILL cleanup like the multi
launcher. Focused SIGTERM controls prove the single real app/Vite ports and
the multi launcher's direct app/Gateway/Vite fixture ports become reusable;
the six launcher tests passed. The local single-process entrypoint previously
fell back to the fixed browser origin 5173 even with a selected UI port. A
real compiled HTTP OPTIONS preflight for a custom port was RED with 403, then
GREEN after forwarding the validated selected UI port to the existing
`webOrigin` option; the app/Projects tests passed 9/9 after rebuild.

The actual 32-post burst and both UI modes remain live acceptance work.
