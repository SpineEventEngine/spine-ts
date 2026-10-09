# Release Notes Studio

This private desktop example currently provides a secure ChatGPT account and model-selection shell. The release-note Agent workflow is added in the next implementation slice.

From the repository root, install dependencies and the pinned Electron binary, then build and launch the development app:

```sh
pnpm install --ignore-scripts
pnpm --filter @spine-event-engine/example-release-notes exec install-electron --no
pnpm --filter @spine-event-engine/example-release-notes build
pnpm --filter @spine-event-engine/example-release-notes start
```

To create a local macOS `.app` and run the development and packaged lifecycle tests:

```sh
pnpm --filter @spine-event-engine/example-release-notes package
pnpm --filter @spine-event-engine/example-release-notes test:electron
```

The app opens the official ChatGPT sign-in page in the system browser and receives one authorization callback on `127.0.0.1`. An account must grant `chatgpt.tokens.use.direct` before its plan can be used. The trusted process verifies signed identity tokens and keeps refreshed credentials encrypted with Electron `safeStorage`; it does not send tokens, authorization URLs, or token hints to the renderer. If the first grant returns `invalid_grant`, the account screen offers a retry with the retained issued client ID and new browser authorization secrets, including after an app restart. It fetches the selected account's model catalog instead of assuming a universal model. Sign-out attempts to revoke the refresh token, clears local credentials even if revocation fails, and reports whether remote revocation was confirmed. The installation identifier and issued client mapping remain so the app can reconnect the account.

This is a local development build. It has not yet been code-signed or notarized, and automated tests use controlled OAuth responses rather than a live ChatGPT account.
