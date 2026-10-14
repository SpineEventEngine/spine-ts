# Message Board single-process live run

This is a preliminary run against the local React single-process exception. The supported launcher ran from the assigned worktree with an isolated Gateway port (`28090`) and UI port (`25173`). Its `pnpm typecheck:build` completed successfully; the stock Vite UI became ready. Runtime versions were Node `v24.18.0`, pnpm `11.9.0`, Python `3.14.3`, Playwright Chromium `156.0.8078.4`.

The real UI rendered the Message Board heading, but the browser did not reach `Updating live`. Both the initial Read query and Subscription preflight were blocked by CORS because the browser origin `http://127.0.0.1:25173` was not configured as the single-process server's allowed origin. The browser result, console errors, failed requests, and screenshot directory are preserved in `browser-live/`. This is a failed acceptance result and must not be represented as a passing UI journey.

The run used launcher PID `86145`, app Node PID `88725` on `127.0.0.1:28090`, Vite package-manager PID `88731`, and Vite Node PID `88732` on `127.0.0.1:25173`. The process/listener snapshots are `process-tree-before-cleanup.txt` and `listeners-before-cleanup.txt`. After Ctrl-C, all three service PIDs were absent and both service ports had no listeners; see the corresponding `*-after-cleanup.txt` files. The app's startup output was written to a launcher-created temporary file and removed by its trap; it was not preserved before teardown. The launcher and browser stdout/stderr are preserved separately.

Two earlier connection-refused attempts are retained under `browser/` and in `browser-run.log` from short exec wrappers. Those wrappers closed their launcher process when the wrapper session ended; they are harness lifecycle failures, not source behavior evidence. The actual persistent-session run above is the source behavior observation.

Builds and outputs were confined to this worktree. No application or test source was edited by this verification function. Further launch/build work is paused while the implementation correction and final transport matrix proceed.
