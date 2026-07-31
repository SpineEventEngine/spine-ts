import { Client, BrowserSession } from "@spine-event-engine/client-web";
import { createRoot } from "react-dom/client";

import { ChatBrowserApp, type BrowserChatSession } from "./index.js";
import { LocalChatGateway } from "./local-config.js";

declare global {
  interface ImportMeta {
    readonly env: Readonly<Record<string, string | undefined>>;
    readonly hot?: Readonly<{ dispose(onDispose: () => void): void }>;
  }
}

const session = BrowserSession.bearer({ token: "chat-local-fixture" });
const client = Client.forConnect(LocalChatGateway.url(import.meta.env), {
  credentials: session.credentials,
  onRequestMetadata: () => session.requestMetadata(),
});
const request = client.onBehalfOf("ada");
const browserSession: BrowserChatSession = {
  status: "signedIn",
  actor: "ada",
  signIn: async () => browserSession,
};
const root = createRoot(document.getElementById("root")!);

root.render(<ChatBrowserApp room="general" request={request} session={browserSession} />);

const close = () => Promise.all([client.close(), session.close()]).then(() => undefined);
window.addEventListener("pagehide", () => void close(), { once: true });
if (import.meta.hot) import.meta.hot.dispose(() => void close());
