const minimumMajor = 24;
const [major] = process.versions.node.split(".").map((part) => Number.parseInt(part, 10));

if (!Number.isInteger(major) || major < minimumMajor) {
  console.error(
    `Node ${process.versions.node} is unsupported. Use Node ${minimumMajor} LTS or newer.`,
  );
  process.exit(1);
}
