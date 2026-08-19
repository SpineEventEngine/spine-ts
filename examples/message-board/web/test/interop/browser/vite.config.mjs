// Serves the small browser fixture used only by the interop test suite.
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: 4175,
    https: {
      key: readFileSync(process.env.E1_VITE_TLS_KEY),
      cert: readFileSync(process.env.E1_VITE_TLS_CERT),
    },
  },
});
