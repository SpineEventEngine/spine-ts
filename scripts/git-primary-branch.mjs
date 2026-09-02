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

/**
 * Finds the merge base against the repository's primary remote branch.
 *
 * @param runGit Runs a Git command and returns its status and standard output.
 * @returns The merge-base commit, or `undefined` when official `master` is unusable.
 */
export function findPrimaryMergeBase(runGit) {
  const result = runGit(["merge-base", "origin/master", "HEAD"]);
  const base = result.stdout.trim();
  return result.status === 0 && base !== "" ? base : undefined;
}
