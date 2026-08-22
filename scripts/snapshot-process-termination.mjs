export function terminationPlan(platform, pid) {
  return platform === "win32"
    ? { command: "taskkill", args: ["/PID", String(pid), "/T", "/F"] }
    : { command: "kill", args: ["-TERM", `-${pid}`] };
}
