import process from "node:process";

import { runProjectManagementLoad, projectManagementLoadLevels } from "../src/load-runner.js";
import { startProjectManagementServer } from "../src/index.js";

const requestedUsers = Number.parseInt(process.env.SPINE_PROJECT_LOAD_USERS ?? "10", 10);
if (!projectManagementLoadLevels.includes(requestedUsers as 10 | 25 | 50 | 100)) {
  throw new Error("SPINE_PROJECT_LOAD_USERS must be one of 10, 25, 50, or 100.");
}

const server = await startProjectManagementServer({ host: "127.0.0.1", port: 0 });
try {
  const result = await runProjectManagementLoad({
    baseUrl: server.baseUrl,
    users: requestedUsers as 10 | 25 | 50 | 100,
  });
  console.log(JSON.stringify(result));
} finally {
  await server.close();
}
