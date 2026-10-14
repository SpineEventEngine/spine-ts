# Local Message Board API and origin rereview

Disposition: clean; no confirmed public API, type, or origin-contract finding in the narrow correction.

Assignment profile: existing TypeScript/API reviewer concern, explicitly dispatched as `gpt-6-sol` with `medium` reasoning. Runtime self-introspection metadata is unavailable on this surface; the dispatch profile is the available record.

`examples/message-board/app/src/local-application-server.ts` now validates the selected `MESSAGE_BOARD_WEB_PORT` as a TCP port and passes `http://127.0.0.1:<selected port>` through the existing public `BoardServerOptions.webOrigin` option. `MessageBoardApplication.run()` passes that value to `BrowserServer.run()` as its sole admitted origin. The default remains `http://127.0.0.1:5173`. No framework API, declaration, export, Protobuf schema, or TypeDoc contract changes.

`examples/message-board/scripts/start-local-single-process.sh` validates distinct Gateway/UI ports, forwards both selected values to the compiled app, passes the selected Gateway URL to Vite, and binds Vite to the selected loopback UI port with `--strictPort`. Its default ports remain 8090 and 5173. The app's port-zero allowance is appropriate for direct test invocation; the tutorial launcher requires a concrete nonzero port.

The supplied mechanical evidence records the actual selected-origin OPTIONS preflight as red with 403 before correction and green after it, plus nine app/Projects tests, six launcher tests, and the affected build/static checks passing. I did not rerun tests or live browser verification. The earlier clean DDD and nine-route TaskCreated disposition remains unchanged.
