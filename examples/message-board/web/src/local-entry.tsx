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

import { Client, BrowserSession } from "@spine-event-engine/client-web";
import { createRoot } from "react-dom/client";

import "./index.css";
import { MessageBoardApp, type BoardSession } from "./index.js";
import { LocalBoardGateway } from "./board-config.js";

declare global {
  interface ImportMeta {
    readonly env: Readonly<Record<string, string | undefined>>;
    readonly hot?: Readonly<{ dispose(onDispose: () => void): void }>;
  }
}

const session = BrowserSession.bearer({ token: "message-board-local-fixture" });
const client = Client.forConnect(LocalBoardGateway.url(import.meta.env), {
  credentials: session.credentials,
  onRequestMetadata: () => session.requestMetadata(),
});
const request = client.onBehalfOf("ada");
const browserSession: BoardSession = {
  status: "signedIn",
  actor: "ada",
  signIn: async () => browserSession,
};
const root = createRoot(document.getElementById("root")!);

root.render(<MessageBoardApp board="general" request={request} session={browserSession} />);

const close = () => Promise.all([client.close(), session.close()]).then(() => undefined);
window.addEventListener("pagehide", () => void close(), { once: true });
if (import.meta.hot) import.meta.hot.dispose(() => void close());
