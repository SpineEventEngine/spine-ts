import console from "node:console";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { Datastore } from "@google-cloud/datastore";

function keyName(entity, keySymbol) {
  const key = entity?.[keySymbol];
  return key?.name ?? (Array.isArray(key?.path) ? key.path.at(-1) : undefined);
}

export function datastoreEntityFindings(namespace, kind, entities, keySymbol) {
  const prefix = namespace.length === 0 ? "(default)" : namespace;
  const findings = [];
  for (const entity of entities) {
    if (Object.hasOwn(entity, "_scope")) findings.push(`${prefix}/${kind}:_scope`);
    const name = keyName(entity, keySymbol);
    if (typeof name === "string" && name.includes("\u0000")) {
      findings.push(`${prefix}/${kind}:scope-derived-key`);
    }
  }
  return [...new Set(findings)].sort();
}

async function metadataNames(client, namespace, kind) {
  const query = client.createQuery(namespace, kind).select("__key__");
  const [entities] = await client.runQuery(query);
  return entities
    .map((entity) => keyName(entity, client.KEY))
    .filter((name) => typeof name === "string");
}

export async function inspectDatastore(client) {
  const namespaces = ["", ...(await metadataNames(client, "", "__namespace__"))];
  const findings = [];
  for (const namespace of [...new Set(namespaces)].sort()) {
    const kinds = await metadataNames(client, namespace, "__kind__");
    for (const kind of [...new Set(kinds)].sort()) {
      if (kind.startsWith("__")) continue;
      const query = client.createQuery(namespace, kind);
      const [entities] = await client.runQuery(query);
      findings.push(...datastoreEntityFindings(namespace, kind, entities, client.KEY));
    }
  }
  return [...new Set(findings)].sort();
}

export function datastoreProject(args, environment = process.env) {
  if (args.length === 0 && environment.GOOGLE_CLOUD_PROJECT !== undefined) {
    return environment.GOOGLE_CLOUD_PROJECT;
  }
  if (args.length !== 2 || args[0] !== "--project" || args[1].length === 0) {
    throw new Error("Provide --project or GOOGLE_CLOUD_PROJECT.");
  }
  return args[1];
}

async function main() {
  try {
    const projectId = datastoreProject(process.argv.slice(2));
    const client = new Datastore({ projectId });
    const findings = await inspectDatastore(client);
    if (findings.length > 0) {
      console.error("Datastore contains legacy Spine layout:");
      for (const finding of findings) console.error(`  ${finding}`);
      process.exitCode = 1;
    }
  } catch {
    console.error("Datastore legacy-layout inventory failed.");
    process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main();
}
