import { BrowserSession, Client } from "@spine-event-engine/client-web";

const session = BrowserSession.cookie({ maxRequestMs: 10_000 });
const client = Client.forGrpcWeb("http://127.0.0.1:8080", {
  tenant: "tasks",
  credentials: session.credentials,
  onRequestMetadata: () => session.requestMetadata(),
});

await client.close();
await session.close();
