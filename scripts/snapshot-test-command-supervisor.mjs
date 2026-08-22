import { spawn } from "node:child_process";

const { command, args, cwd, timeout } = JSON.parse(process.argv[2]);
const child = spawn(command, args, { cwd, detached: process.platform !== "win32", stdio: "pipe" });
let stdout = "";
let stderr = "";
child.stdout.on("data", (chunk) => (stdout += chunk));
child.stderr.on("data", (chunk) => (stderr += chunk));
let timedOut = false;
let shutdown = Promise.resolve();
const timer = setTimeout(() => {
  timedOut = true;
  shutdown = terminateGroup();
}, timeout);
const result = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("close", (status) => resolve({ status }));
});
clearTimeout(timer);
await shutdown;
process.stdout.write(JSON.stringify({ ...result, timedOut, stdout, stderr }));

function signal(value) {
  try {
    process.kill(-child.pid, value);
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

async function terminateGroup() {
  signal("SIGTERM");
  if (await gone(200)) return;
  signal("SIGKILL");
  if (!(await gone(1_000)))
    throw new Error(`Timed-out process group ${child.pid} did not terminate.`);
}

async function gone(timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      process.kill(-child.pid, 0);
    } catch (error) {
      if (error?.code === "ESRCH") return true;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return false;
}
