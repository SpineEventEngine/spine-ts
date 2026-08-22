import { spawn } from "node:child_process";

const { command, args, cwd, timeout } = JSON.parse(process.argv[2]);
const child = spawn(command, args, { cwd, detached: process.platform !== "win32", stdio: "pipe" });
let stdout = "";
let stderr = "";
child.stdout.on("data", (chunk) => (stdout += chunk));
child.stderr.on("data", (chunk) => (stderr += chunk));
let timedOut = false;
const timer = setTimeout(() => {
  timedOut = true;
  signal("SIGTERM");
  setTimeout(() => signal("SIGKILL"), 200);
}, timeout);
const result = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("close", (status) => resolve({ status }));
});
clearTimeout(timer);
process.stdout.write(JSON.stringify({ ...result, timedOut, stdout, stderr }));

function signal(value) {
  try {
    process.kill(-child.pid, value);
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}
