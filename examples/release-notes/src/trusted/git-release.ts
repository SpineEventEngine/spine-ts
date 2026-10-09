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

import { createHash } from "node:crypto";
import { realpath, stat } from "node:fs/promises";

import { GitAdmission, type GitAdmissionControl } from "./git-admission.js";
import { GitCommand } from "./git-command.js";

/**
 * Trusted technical selection before revisions are pinned.
 */
export interface GitComparisonInput {
  /**
   * Selected repository directory.
   */
  readonly repository: string;

  /**
   * Trusted absolute Git executable.
   */
  readonly gitExecutable: string;

  /**
   * Base commit or revision selector.
   */
  readonly base: string;

  /**
   * Target commit or revision selector.
   */
  readonly target: string;
}

/**
 * Fixed cross-process comparison with selected repository identity.
 */
export interface GitWorkerBinding extends GitComparisonInput {
  /**
   * Filesystem device of the selected repository.
   */
  readonly repositoryDevice: number;

  /**
   * Filesystem inode of the selected repository.
   */
  readonly repositoryInode: number;

  /**
   * SHA-256 digest of the exact accepted catalog.
   */
  readonly catalogDigest: string;
}

/**
 * One changed path in a Git tree comparison.
 */
export interface GitChange {
  /**
   * Literal target-side path.
   */
  readonly path: string;

  /**
   * Git change status, including rename similarity when applicable.
   */
  readonly status: string;

  /**
   * Literal source-side path for a rename or copy.
   */
  readonly previousPath?: string;
}

/**
 * Per-parent committed change available for an exact patch read.
 */
export interface GitEvidence extends GitChange {
  /**
   * Full commit object ID.
   */
  readonly commit: string;

  /**
   * Full parent commit object ID.
   */
  readonly parent: string;
}

/**
 * Commit reachable from target and not base.
 */
export interface GitCommit {
  /**
   * Full commit object ID.
   */
  readonly commit: string;

  /**
   * Full parent IDs, including both parents of a merge.
   */
  readonly parents: readonly string[];

  /**
   * Untrusted one-line commit subject.
   */
  readonly subject: string;
}

/**
 * Commit row from the paged catalog.
 */
export interface GitCommitListing extends GitCommit {
  /**
   * Commit row discriminator.
   */
  readonly kind: "commit";
}

/**
 * Net change row from the paged catalog.
 */
export interface GitChangeListing extends GitChange {
  /**
   * Net change row discriminator.
   */
  readonly kind: "change";
}

/**
 * Per-parent evidence row from the paged catalog.
 */
export interface GitEvidenceListing extends GitEvidence {
  /**
   * Evidence row discriminator.
   */
  readonly kind: "evidence";
}

/**
 * One typed row from the paged verified catalog.
 */
export type GitListingEntry = GitCommitListing | GitChangeListing | GitEvidenceListing;

const GitCodec = {
  /**
   * Decodes valid UTF-8 Git output.
   *
   * @param buffer Complete Git output.
   * @returns Decoded text.
   */
  text(buffer: Buffer): string {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  },

  /**
   * Parses NUL-delimited status and literal paths.
   *
   * @param buffer Complete diff status output.
   * @returns Ordered changes.
   */
  parseChanges(buffer: Buffer): GitChange[] {
    const fields = this.text(buffer).split("\0");
    const changes: GitChange[] = [];
    for (let index = 0; index < fields.length - 1;) {
      const status = fields[index++];
      const first = fields[index++];
      if (!status || first === undefined) throw new Error("Malformed Git change catalog.");
      if (status.startsWith("R") || status.startsWith("C")) {
        const path = fields[index++];
        if (path === undefined) throw new Error("Malformed Git rename catalog.");
        changes.push({ status, path, previousPath: first });
      } else changes.push({ status, path: first });
    }
    return changes;
  },
};

/**
 * Immutable comparison of committed Git objects and its verified evidence catalog.
 */
export class GitReleaseComparison {
  /**
   * Stores a complete, detached catalog and fixed repository identity.
   *
   * @param repository Canonical selected repository path.
   * @param executable Trusted absolute Git executable.
   * @param repositoryDevice Filesystem device at selection.
   * @param repositoryInode Filesystem inode at selection.
   * @param baseCommit Full pinned base commit.
   * @param targetCommit Full pinned target commit.
   * @param commits Complete target-not-base commit list.
   * @param changes Complete net changed path list.
   * @param evidence Complete per-parent evidence list.
   */
  private constructor(
    private readonly repository: string,
    private readonly executable: string,
    private readonly repositoryDevice: number,
    private readonly repositoryInode: number,
    readonly baseCommit: string,
    readonly targetCommit: string,
    readonly commits: readonly GitCommit[],
    readonly changes: readonly GitChange[],
    readonly evidence: readonly GitEvidence[],
  ) {
    this.commits = Object.freeze(
      commits.map((entry) =>
        Object.freeze({
          ...entry,
          parents: Object.freeze([...entry.parents]),
        }),
      ),
    );
    this.changes = Object.freeze(changes.map((entry) => Object.freeze({ ...entry })));
    this.evidence = Object.freeze(evidence.map((entry) => Object.freeze({ ...entry })));
    Object.freeze(this);
  }

  /**
   * Resolves references once and verifies the bounded committed comparison.
   *
   * @param input Trusted repository, executable, and revision selectors.
   * @param control Optional cancellation and deadline for the complete admission.
   * @returns Pinned comparison and complete catalog.
   */
  static async open(
    input: GitComparisonInput,
    control?: GitAdmissionControl,
  ): Promise<GitReleaseComparison> {
    const admission = new GitAdmission(control);
    try {
      const repository = await realpath(input.repository);
      const info = await stat(repository);
      const run = (args: string[]) => admission.run(input.gitExecutable, repository, args);
      const base = await this.resolveCommit(run, input.base);
      const target = await this.resolveCommit(run, input.target);
      const ancestor = await run(["merge-base", "--is-ancestor", base, target]).then(
        () => true,
        () => false,
      );
      if (!ancestor) throw new Error("Release base must be an ancestor of the target.");
      const { commits, evidence } = await this.catalogCommits(run, base, target, admission);
      const changes = await this.netChanges(run, base, target, admission);
      return new GitReleaseComparison(
        repository,
        input.gitExecutable,
        info.dev,
        info.ino,
        base,
        target,
        commits,
        changes,
        evidence,
      );
    } finally {
      admission.close();
    }
  }

  /**
   * Compares pinned trees for complete net changes.
   *
   * @param run Bound Git command runner.
   * @param base Pinned base commit.
   * @param target Pinned target commit.
   * @param admission Shared catalog admission budget.
   * @returns Complete bounded net changed paths.
   */
  private static async netChanges(
    run: (args: string[]) => Promise<Buffer>,
    base: string,
    target: string,
    admission: GitAdmission,
  ) {
    const changes = GitCodec.parseChanges(
      await run([
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "--name-status",
        "-z",
        "-M",
        base,
        target,
        "--",
      ]),
    );
    if (changes.length > 2_000) throw new Error("Change catalog exceeds bound; narrow the range.");
    for (const change of changes) admission.record(change);
    return changes;
  }

  /**
   * Resolves one revision selector to a full commit object ID.
   *
   * @param run Bound Git command runner.
   * @param revision Trusted revision selector.
   * @returns Full SHA-1 or SHA-256 commit ID.
   */
  private static async resolveCommit(run: (args: string[]) => Promise<Buffer>, revision: string) {
    const id = GitCodec.text(
      await run(["rev-parse", "--verify", "--end-of-options", `${revision}^{commit}`]),
    ).trim();
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(id))
      throw new Error("Git commit identity is invalid.");
    return id;
  }

  /**
   * Builds every target-not-base commit and parent diff entry.
   *
   * @param run Bound Git command runner.
   * @param base Pinned base commit.
   * @param target Pinned target commit.
   * @param admission Shared catalog admission budget.
   * @returns Complete bounded commit and evidence lists.
   */
  private static async catalogCommits(
    run: (args: string[]) => Promise<Buffer>,
    base: string,
    target: string,
    admission: GitAdmission,
  ) {
    const rows = GitCodec.text(
      await run(["rev-list", "--parents", "--reverse", `${base}..${target}`]),
    ).trim();
    const ids = rows ? rows.split("\n") : [];
    if (ids.length > 200) throw new Error("Commit catalog exceeds bound; narrow the range.");
    const commits: GitCommit[] = [];
    const evidence: GitEvidence[] = [];
    for (const row of ids) {
      const [commit, ...parents] = row.split(" ");
      if (!commit) throw new Error("Malformed Git commit catalog.");
      if (parents.length === 0)
        throw new Error("Unrelated-history root commit is unsupported; narrow the range.");
      const subject = GitCodec.text(await run(["show", "-s", "--format=%s", commit])).trim();
      const entry = { commit, parents, subject };
      admission.record(entry);
      commits.push(entry);
      for (const parent of parents) {
        for (const item of await this.parentEvidence(run, commit, parent)) {
          admission.record(item);
          evidence.push(item);
        }
        if (evidence.length > 2_000)
          throw new Error("Evidence catalog exceeds bound; narrow the range.");
      }
    }
    return { commits, evidence };
  }

  /**
   * Builds one parent edge, including either side of a merge.
   *
   * @param run Bound Git command runner.
   * @param commit Full child commit ID.
   * @param parent Full parent commit ID.
   * @returns Ordered per-parent evidence entries.
   */
  private static async parentEvidence(
    run: (args: string[]) => Promise<Buffer>,
    commit: string,
    parent: string,
  ) {
    const diff = await run([
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--name-status",
      "-z",
      "-M",
      parent,
      commit,
      "--",
    ]);
    return GitCodec.parseChanges(diff).map((change) => ({ ...change, commit, parent }));
  }

  /**
   * Executes a command only while the selected path retains its identity.
   *
   * @param args Fixed Git arguments.
   * @param maxBytes Maximum stdout bytes.
   * @param signal Optional cancellation signal.
   * @returns Complete bounded command output.
   */
  private async run(args: string[], maxBytes?: number, signal?: AbortSignal): Promise<Buffer> {
    const info = await stat(this.repository);
    if (info.dev !== this.repositoryDevice || info.ino !== this.repositoryInode) {
      throw new Error("Selected Git repository changed.");
    }
    return GitCommand.run(this.executable, this.repository, args, maxBytes, signal);
  }

  /**
   * Returns only fixed technical inputs for a scoped local worker process.
   *
   * @returns Detached process binding with full object IDs.
   */
  workerBinding(): GitWorkerBinding {
    return {
      repository: this.repository,
      gitExecutable: this.executable,
      base: this.baseCommit,
      target: this.targetCommit,
      repositoryDevice: this.repositoryDevice,
      repositoryInode: this.repositoryInode,
      catalogDigest: this.catalogDigest(),
    };
  }

  /**
   * Calculates the hash of the exact ordered accepted catalog for cross-process verification.
   *
   * @returns SHA-256 hex digest of pinned identities and catalog entries.
   */
  catalogDigest(): string {
    return createHash("sha256")
      .update(
        JSON.stringify({
          base: this.baseCommit,
          target: this.targetCommit,
          commits: this.commits,
          changes: this.changes,
          evidence: this.evidence,
        }),
      )
      .digest("hex");
  }

  /**
   * Lists the complete accepted catalog in bounded pages.
   *
   * @param pageToken Optional continuation from the previous page.
   * @returns One page and an explicit continuation when more remains.
   */
  listReleaseChanges(pageToken?: string): {
    readonly entries: readonly GitListingEntry[];
    readonly complete: true;
    readonly nextPageToken?: string;
  } {
    if (pageToken !== undefined && !/^(?:0|[1-9][0-9]{0,5})$/.test(pageToken)) {
      throw new Error("Invalid catalog page token.");
    }
    const offset = pageToken === undefined ? 0 : Number(pageToken);
    const entries: GitListingEntry[] = [
      ...this.commits.map((entry) => ({ ...entry, kind: "commit" as const })),
      ...this.changes.map((entry) => ({ ...entry, kind: "change" as const })),
      ...this.evidence.map((entry) => ({ ...entry, kind: "evidence" as const })),
    ];
    if (offset > entries.length) throw new Error("Invalid catalog page token.");
    const next = offset + 20;
    return {
      entries: entries.slice(offset, next),
      complete: true,
      ...(next < entries.length ? { nextPageToken: String(next) } : {}),
    };
  }

  /**
   * Reads a patch only for an exact verified evidence entry.
   *
   * @param request Exact cataloged commit, parent, status, and paths.
   * @param signal Optional cancellation signal.
   * @returns Complete patch or explicit incomplete reason.
   */
  async readChangePatch(
    request: GitEvidence,
    signal?: AbortSignal,
  ): Promise<{ complete: boolean; patch?: string; reason?: string }> {
    const found = this.evidence.some(
      (entry) =>
        entry.commit === request.commit &&
        entry.parent === request.parent &&
        entry.path === request.path &&
        entry.previousPath === request.previousPath &&
        entry.status === request.status,
    );
    if (!found) throw new Error("Requested patch is outside the verified catalog.");
    return this.patch(request, signal);
  }

  /**
   * Reads a bounded literal-path diff after catalog membership is checked.
   *
   * @param request Verified evidence entry.
   * @param signal Optional cancellation signal.
   * @returns Complete patch or explicit incomplete reason.
   */
  private async patch(request: GitEvidence, signal?: AbortSignal) {
    const paths = (
      request.previousPath ? [request.previousPath, request.path] : [request.path]
    ).map((path) => `:(literal)${path}`);
    try {
      const patch = GitCodec.text(
        await this.run(
          [
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            "-M",
            request.parent,
            request.commit,
            "--",
            ...paths,
          ],
          200_000,
          signal,
        ),
      );
      if (patch.includes("GIT binary patch") || patch.includes("Binary files ")) {
        return { complete: false, reason: "binary-change" };
      }
      return { complete: true, patch };
    } catch {
      return { complete: false, reason: "patch-unavailable-or-too-large" };
    }
  }

  /**
   * Reads a regular file from the pinned target tree only when cataloged.
   *
   * @param path Literal target path from the net change catalog.
   * @param signal Optional cancellation signal.
   * @returns Complete text or explicit incomplete reason.
   */
  async readReleaseFile(
    path: string,
    signal?: AbortSignal,
  ): Promise<{ complete: boolean; targetCommit: string; text?: string; reason?: string }> {
    if (!this.changes.some((change) => change.path === path && !change.status.startsWith("D"))) {
      throw new Error("Requested release file is outside the verified catalog.");
    }
    const tree = GitCodec.text(
      await this.run(
        ["ls-tree", "-z", this.targetCommit, "--", `:(literal)${path}`],
        undefined,
        signal,
      ),
    );
    const match = /^(100644|100755) blob ([a-f0-9]{40}|[a-f0-9]{64})\t([^\0]+)\0$/.exec(tree);
    const objectId = match?.[2];
    if (match?.[3] !== path || objectId === undefined)
      return { complete: false, targetCommit: this.targetCommit, reason: "not-regular-file" };
    try {
      const content = GitCodec.text(
        await this.run(["cat-file", "blob", objectId], 200_000, signal),
      );
      if (content.includes("\0"))
        return { complete: false, targetCommit: this.targetCommit, reason: "binary-file" };
      return { complete: true, targetCommit: this.targetCommit, text: content };
    } catch {
      return {
        complete: false,
        targetCommit: this.targetCommit,
        reason: "file-unavailable-or-too-large",
      };
    }
  }
}
