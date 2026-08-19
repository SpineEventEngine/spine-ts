/**
 * Serves the one built Message Board UI artifact in container deployments.
 *
 * Browser routes fall back to the entry document while static assets retain
 * their content type and stay constrained to the Vite output directory.
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..", "dist");
const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".svg", "image/svg+xml"],
]);
const server = createServer((request, response) => {
  const path = new URL(request.url ?? "/", "http://localhost").pathname;
  if (path === "/message-board-runtime-config.js") {
    const gateway = process.env.MESSAGE_BOARD_GATEWAY_URL ?? "http://localhost:18080";
    response.writeHead(200, {
      "content-type": "text/javascript; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(
      `window.MESSAGE_BOARD_RUNTIME_CONFIG=${JSON.stringify({ MESSAGE_BOARD_GATEWAY_URL: gateway })};`,
    );
    return;
  }
  const candidate = resolve(root, `.${path}`);
  const chosen =
    candidate.startsWith(`${root}/`) && existsSync(candidate) && statSync(candidate).isFile()
      ? candidate
      : resolve(root, "index.html");
  response.writeHead(200, {
    "content-type": contentTypes.get(extname(chosen)) ?? "application/octet-stream",
  });
  createReadStream(chosen).pipe(response);
});

server.listen(Number(process.env.PORT ?? 8080), "0.0.0.0");
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => server.close(() => process.exit(0)));
