import { existsSync, readFileSync } from "node:fs";

const entries = [
  ".",
  "packages/auth",
  "packages/client-node",
  "packages/client-react",
  "packages/client-web",
  "packages/core",
  "packages/delivery-client",
  "packages/delivery-server",
  "packages/proto-tools",
  "packages/proto",
  "packages/server",
  "packages/storage-datastore",
  "packages/storage-rdbms",
  "packages/storage",
  "packages/testing",
  "packages/transport",
  "examples/chat",
  "examples/chat/app",
  "examples/chat/model",
  "examples/chat/web",
  "examples/todo",
  "examples/projects",
  "examples/orders",
];
const prohibited = /\b(?:T-\d{4}|wave\s+\d+|reviewer|remediation)\b/i;
const failures = [];

for (const entry of entries) {
  const prefix = entry === "." ? "" : `${entry}/`;
  const readme = `${prefix}README.md`;
  const reference = `${prefix}REFERENCE.md`;
  if (!existsSync(readme)) failures.push(`${readme} is missing`);
  if (!existsSync(reference)) failures.push(`${reference} is missing`);
  if (!existsSync(readme)) continue;
  const text = readFileSync(readme, "utf8");
  if (!/\]\(REFERENCE\.md\)/.test(text) || !/agent/i.test(text)) {
    failures.push(`${readme} must link to its coding-agent reference`);
  }
  if (prohibited.test(text)) failures.push(`${readme} contains internal project wording`);
}

if (failures.length > 0) throw new Error(failures.join("\n"));
