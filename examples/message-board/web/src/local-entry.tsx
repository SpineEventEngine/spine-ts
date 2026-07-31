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
