/*
 * Copyright 2026, CodeMatters. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License
 * is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions and limitations under
 * the License.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const clockHelperNames = new Set(["now", "timestampNow", "currentTimestamp", "currentTime"]);

/**
 * Finds first-party reads of platform clocks and imported clock helpers in executable syntax.
 * Strings and comments are parsed as data, so fixture text does not produce a finding.
 *
 * @param {string} source File contents.
 * @param {string} [fileName] Filename used for TypeScript parser mode.
 * @returns {readonly string[]} Clock calls with line and column locations.
 */
export function findTimeBypasses(source, fileName = "fixture.ts") {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const dates = new Set(["Date"]);
  const performances = new Set(["performance"]);
  const processes = new Set(["process"]);
  const walls = new Set();
  const monotonic = new Set();
  const helpers = new Set();

  const name = (node) => (ts.isIdentifier(node) ? node.text : undefined);
  const property = (node) =>
    ts.isPropertyAccessExpression(node)
      ? { object: node.expression, field: node.name.text }
      : ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression)
        ? { object: node.expression, field: node.argumentExpression.text }
        : undefined;

  const classify = (value) => {
    const identifier = name(value);
    if (identifier !== undefined) {
      if (dates.has(identifier)) return "date";
      if (performances.has(identifier)) return "performance";
      if (processes.has(identifier)) return "process";
      if (walls.has(identifier)) return "wall";
      if (monotonic.has(identifier)) return "monotonic";
      if (helpers.has(identifier)) return "helper";
    }
    const member = property(value);
    if (member !== undefined) {
      if (
        name(member.object) === "globalThis" &&
        ["Date", "performance", "process"].includes(member.field)
      )
        return { Date: "date", performance: "performance", process: "process" }[member.field];
      const source = classify(member.object);
      if (source === "date" && member.field === "now") return "wall";
      if (source === "performance" && member.field === "now") return "monotonic";
      if (source === "process" && member.field === "hrtime") return "monotonic";
      if (source === "monotonic" && member.field === "bigint") return "monotonic";
    }
    return undefined;
  };

  const collectAliases = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const imports = node.importClause?.namedBindings;
      if (imports && ts.isNamedImports(imports)) {
        for (const item of imports.elements) {
          const imported = (item.propertyName ?? item.name).text;
          if (clockHelperNames.has(imported)) helpers.add(item.name.text);
          if (node.moduleSpecifier.text === "node:perf_hooks" && imported === "performance")
            performances.add(item.name.text);
          if (node.moduleSpecifier.text === "node:process" && imported === "hrtime")
            monotonic.add(item.name.text);
        }
      }
    }
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const kind = classify(node.initializer);
      if (ts.isIdentifier(node.name)) {
        const target = {
          date: dates,
          performance: performances,
          process: processes,
          wall: walls,
          monotonic,
          helper: helpers,
        }[kind];
        target?.add(node.name.text);
      } else if (ts.isObjectBindingPattern(node.name)) {
        const sourceKind = classify(node.initializer);
        for (const item of node.name.elements) {
          if (!ts.isIdentifier(item.name)) continue;
          const field = item.propertyName?.getText(file) ?? item.name.text;
          if (sourceKind === "date" && field === "now") walls.add(item.name.text);
          if (sourceKind === "performance" && field === "now") monotonic.add(item.name.text);
          if (sourceKind === "process" && field === "hrtime") monotonic.add(item.name.text);
        }
      }
    }
    ts.forEachChild(node, collectAliases);
  };
  collectAliases(file);

  const findings = [];
  const visit = (node) => {
    let bypass = false;
    if (ts.isNewExpression(node)) {
      bypass = (node.arguments?.length ?? 0) === 0 && classify(node.expression) === "date";
    } else if (ts.isCallExpression(node)) {
      const kind = classify(node.expression);
      bypass = kind === "wall" || kind === "monotonic" || kind === "helper" || kind === "date";
    } else if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const kind = classify(node);
      bypass =
        (kind === "wall" || kind === "monotonic") &&
        !(ts.isCallExpression(node.parent) && node.parent.expression === node) &&
        !(
          (ts.isPropertyAccessExpression(node.parent) ||
            ts.isElementAccessExpression(node.parent)) &&
          node.parent.expression === node
        );
    }
    if (bypass) {
      const at = file.getLineAndCharacterOfPosition(node.getStart(file));
      findings.push(`${String(at.line + 1)}:${String(at.character + 1)} ${node.getText(file)}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return findings;
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const files = execFileSync(
    "rg",
    ["--files", "packages", "examples", "scripts", "compatibility-tests", "interop"],
    {
      cwd: root,
      encoding: "utf8",
    },
  )
    .trim()
    .split("\n");
  const findings = [];
  for (const path of files) {
    if (
      !/\.(?:[cm]?[jt]s|tsx|jsx)$/.test(path) ||
      /(?:^|\/)(?:generated|dist|node_modules)(?:\/|$)/.test(path) ||
      path === "packages/core/src/time/index.ts"
    )
      continue;
    for (const finding of findTimeBypasses(readFileSync(resolve(root, path), "utf8"), path)) {
      findings.push(`${path}:${finding}`);
    }
  }
  if (findings.length > 0) {
    process.stderr.write(`${findings.join("\n")}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write("First-party time reads use Time.\n");
  }
}
