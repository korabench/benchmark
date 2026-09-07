import {execFileSync} from "node:child_process";

export interface GitInfo {
  commit?: string;
  dirty?: boolean;
}

function git(args: readonly string[]): string {
  return execFileSync("git", [...args], {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

/**
 * Commit and dirty flag of the working tree the CLI runs in. Both are absent
 * outside a git checkout (an installed package, a container without git): the
 * stamp then still carries the package version.
 */
export function readGitInfo(): GitInfo {
  try {
    const commit = git(["rev-parse", "HEAD"]);
    const dirty = git(["status", "--porcelain"]).length > 0;
    return {commit, dirty};
  } catch {
    return {};
  }
}
