# Browser test runtime preparation

**Assignment:** orchestrator-dispatched dependency/tool preparation function; configured `gpt-6-luna` / `medium` explicitly. Runtime self-introspection is unavailable on this execution surface, so the configured profile is recorded as dispatched.

The isolated Python Playwright runtime is ready for the upcoming actual React UI acceptance. This preparation did not build the framework, edit app files, launch services, or establish UI acceptance.

## Runtime

- Python: 3.14.3 (`python3` is available; a `python` command is not).
- Playwright Python: 1.64.0.
- Dependencies: `pyee` 14.0.0, `greenlet` 3.5.6, `typing_extensions` 4.16.0.
- Playwright Chromium revision: 1248, Chrome for Testing / headless shell 156.0.8078.4, macOS arm64.
- Virtual environment, pip cache, temporary directory, and browser downloads are all under `build-protocol/tasks/sql-delivery-reliability/evidence/runtime-tmp/browser-tools/`. `runtime-tmp/` is ignored by the evidence directory's `.gitignore`.
- The bundled `with_server.py --help` was checked. It accepts repeated `--server` / `--port` pairs followed by the browser command; use it only once the UI acceptance launch configuration is ready.

## Smoke result

`chromium-smoke.log` records a successful headless Chromium launch, creation of an empty `about:blank` page, and browser close. Exit status was 0. `runtime-details.txt` records installed versions and confirms no matching Playwright browser process remained after close. This is a tool check only; no app or service was launched.

## Invocation

From the repository worktree, set the task-local paths and run the venv Python. Keep `PLAYWRIGHT_BROWSERS_PATH` set for each invocation so Playwright cannot fall back to a global browser cache:

```sh
TASK_ROOT="$PWD/build-protocol/tasks/sql-delivery-reliability/evidence/runtime-tmp/browser-tools"
export PLAYWRIGHT_BROWSERS_PATH="$TASK_ROOT/browsers"
export PIP_CACHE_DIR="$TASK_ROOT/pip-cache"
export TMPDIR="$TASK_ROOT/tmp"
"$TASK_ROOT/venv/bin/python" path/to/ui_acceptance.py
```

The Playwright context manager closes its driver; the acceptance script must also close the browser in a `finally` block or context-managed cleanup. The app's long-lived subscription stream means a bounded document/control readiness wait is appropriate; an unbounded `networkidle` wait may never finish. Inspect the rendered DOM before choosing selectors and assert actual domain updates.

## Evidence files

- `evidence/browser-tool-preparation/chromium-smoke.log`
- `evidence/browser-tool-preparation/runtime-details.txt`
- `evidence/browser-tool-preparation/with-server-help.txt`

The task-local environment is transient and ignored; recreate it with `python3 -m venv`, `pip install 'playwright==1.64.0'`, and `python -m playwright install chromium` under the same local `PIP_CACHE_DIR`, `TMPDIR`, and `PLAYWRIGHT_BROWSERS_PATH` exports if it is removed.
