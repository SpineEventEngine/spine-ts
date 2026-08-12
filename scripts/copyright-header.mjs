const template = `/*
 * Copyright {year}, CodeMatters. All rights reserved.
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
`;
export function copyrightHeader(year = new Date().getFullYear()) {
  return template.replace("{year}", String(year));
}
export function recognizedCopyrightHeader(contents) {
  const match =
    /^\/\*\n \* Copyright (\d{4}), CodeMatters\. All rights reserved\.\n[\s\S]*? \*\/\n/u.exec(
      contents,
    );
  return match?.[0] === copyrightHeader(Number(match?.[1])) ? match[0] : undefined;
}

/* Preserves the approved header while enforcing one following empty line. */
export function separateCopyrightHeader(contents) {
  const at = contents.startsWith("#!") ? contents.indexOf("\n") + 1 : 0;
  const before = contents.slice(0, at);
  const after = contents.slice(at);
  const header = recognizedCopyrightHeader(after);
  if (header === undefined) return contents;
  return `${before}${header}\n${after.slice(header.length).replace(/^\n*/u, "")}`;
}
